const { PlaywrightCrawler, Sitemap } = require('crawlee');
const { db } = require('./database');
const fs = require('fs');
const path = require('path');

async function runCrawler(startUrl, crawlIdOverride = null, maxRequests = 100, urlKeyword = null, isSitemap = false) {
    console.log(`Starting crawl for ${startUrl} with limit ${maxRequests}, keyword '${urlKeyword}', isSitemap: ${isSitemap}`);

    let crawlId = crawlIdOverride;
    if (!crawlId) {
        // Create a new crawl entry if not provided
        const insertCrawl = db.prepare('INSERT INTO crawls (root_url) VALUES (?)');
        const info = insertCrawl.run(startUrl);
        crawlId = info.lastInsertRowid;
    }

    // Log helper
    const logToDb = (msg) => {
        try {
            db.prepare('INSERT INTO logs (crawl_id, message) VALUES (?, ?)').run(BigInt(crawlId), msg);
        } catch (e) {
            console.error('Failed to log to DB:', e);
        }
    };

    logToDb(`Starting crawl for ${startUrl} (Max pages: ${maxRequests}, Filter: ${urlKeyword || 'None'}, Sitemap: ${isSitemap})`);

    // Prepare statement for inserting resources
    const insertResource = db.prepare(`
        INSERT INTO resources (crawl_id, url, type, status_code, source_page_url)
        VALUES (?, ?, ?, ?, ?)
    `);

    const crawler = new PlaywrightCrawler({
        maxRequestsPerCrawl: maxRequests,
        requestHandler: async ({ page, request, log, enqueueLinks }) => {
            const currentUrl = request.url;
            log.info(`Processing ${currentUrl}`);
            logToDb(`Processing ${currentUrl}`);

            const capturedUrls = new Set();

            // Listen for responses to capture external resources
            page.on('response', async (response) => {
                const url = response.url();
                capturedUrls.add(url);
                const status = response.status();
                const type = response.request().resourceType();

                try {
                    insertResource.run(BigInt(crawlId), url, type, status, currentUrl);
                } catch (err) {
                    log.error(`Failed to save resource ${url}: ${err.message}`);
                }
            });

            page.on('requestfailed', async (request) => {
                const url = request.url();
                capturedUrls.add(url);
                const failure = request.failure();
                const type = request.resourceType();

                // We map failed requests to status 0
                try {
                    insertResource.run(BigInt(crawlId), url, type, 0, currentUrl);
                    logToDb(`Resource failed: ${url} (${failure ? failure.errorText : 'unknown'})`);
                } catch (err) {
                    // ignore
                }
            });

            // Scroll to bottom to trigger lazy loading of images/resources
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 100;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });

            // Wait for network idle after scrolling
            await page.waitForLoadState('networkidle');

            // Find and enqueue links for crawling (same domain)
            const enqueueOptions = {
                strategy: 'same-hostname',
            };

            if (urlKeyword) {
                enqueueOptions.regexps = [new RegExp(urlKeyword, 'i')];
                logToDb(`Filtering links by keyword: ${urlKeyword}`);
            }

            const info = await enqueueLinks(enqueueOptions);

            if (info.processedRequests.length > 0) {
                logToDb(`Found ${info.processedRequests.length} new pages to crawl.`);
            }

            // Manually check ALL resources (links, images, media, scripts) to ensure coverage
            const allResources = await page.evaluate(() => {
                const resources = [];
                const add = (selector, type, attr) => {
                    document.querySelectorAll(selector).forEach(el => {
                        if (el[attr]) resources.push({ url: el[attr], type });
                    });
                };
                add('a[href]', 'link', 'href');
                add('img[src]', 'image', 'src');
                add('video[src], audio[src], source[src]', 'media', 'src');
                add('script[src]', 'script', 'src');
                add('link[rel="stylesheet"]', 'stylesheet', 'href');
                add('object[data]', 'object', 'data');
                add('embed[src]', 'media', 'src');
                return resources;
            });

            // Deduplicate
            const uniqueResources = [];
            const seen = new Set();
            for (const r of allResources) {
                if (!seen.has(r.url)) {
                    seen.add(r.url);
                    uniqueResources.push(r);
                }
            }

            logToDb(`Checking status of ${uniqueResources.length} resources found on page...`);

            for (const resource of uniqueResources) {
                if (!resource.url.startsWith('http')) continue;
                if (capturedUrls.has(resource.url)) continue; // Skip if already captured

                try {
                    // Use Playwright's API context
                    const response = await page.request.fetch(resource.url, { method: 'HEAD' });
                    let status = response.status();

                    if (status >= 400) {
                        const getResponse = await page.request.fetch(resource.url, { method: 'GET' });
                        status = getResponse.status();
                    }

                    insertResource.run(BigInt(crawlId), resource.url, resource.type, status, currentUrl);
                } catch (e) {
                    insertResource.run(BigInt(crawlId), resource.url, resource.type, 0, currentUrl);
                }
            }
        },
        failedRequestHandler: async ({ request, log }) => {
            log.error(`Request ${request.url} failed.`);
            logToDb(`Failed to process ${request.url}`);
            try {
                insertResource.run(BigInt(crawlId), request.url, 'document', 0, request.url);
            } catch (err) {
                // ignore
            }
        },
    });

    try {
        if (isSitemap) {
            logToDb(`Loading sitemap from ${startUrl}...`);
            const { urls } = await Sitemap.load(startUrl);
            logToDb(`Found ${urls.length} URLs in sitemap.`);

            // Filter by keyword if provided
            let initialUrls = urls;
            if (urlKeyword) {
                const regex = new RegExp(urlKeyword, 'i');
                initialUrls = urls.filter(u => regex.test(u));
                logToDb(`Filtered to ${initialUrls.length} URLs matching '${urlKeyword}'`);
            }

            await crawler.run(initialUrls);
        } else {
            await crawler.run([startUrl]);
        }

        db.prepare('UPDATE crawls SET status = ? WHERE id = ?').run('completed', BigInt(crawlId));
        console.log(`Crawl ${crawlId} completed.`);
        logToDb(`Crawl completed.`);
    } catch (error) {
        console.error('Crawl failed:', error);
        db.prepare('UPDATE crawls SET status = ? WHERE id = ?').run('failed', BigInt(crawlId));
        logToDb(`Crawl failed: ${error.message}`);

    }
}

module.exports = { runCrawler };
