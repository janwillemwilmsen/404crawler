const urlInput = document.getElementById('urlInput');
const crawlBtn = document.getElementById('startBtn');
const statusDiv = document.getElementById('status');
const historyList = document.getElementById('historyList');
const detailsSection = document.getElementById('detailsSection');
const resourcesList = document.getElementById('resourcesList');
const backBtn = document.getElementById('backBtn');
const historySection = document.querySelector('.history-section');

// Load history on start
fetchHistory();

crawlBtn.addEventListener('click', async () => {
    const url = document.getElementById('urlInput').value;
    const maxPages = document.getElementById('maxPagesInput').value;
    const urlKeyword = document.getElementById('keywordInput').value;
    const isSitemap = document.getElementById('isSitemapInput').checked;
    const formData = new FormData();
    formData.append('url', url);
    formData.append('maxPages', maxPages ? parseInt(maxPages) : 100);
    formData.append('urlKeyword', urlKeyword);
    formData.append('isSitemap', isSitemap);

    try {
        const res = await fetch('/api/crawl', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (data.crawlId) {
            window.location.href = `/status.html?id=${data.crawlId}`;
        } else {
            statusDiv.textContent = 'Error: No crawl ID returned.';
        }
    } catch (err) {
        statusDiv.textContent = 'Error starting crawl: ' + err.message;
    }
});

backBtn.addEventListener('click', () => {
    detailsSection.classList.add('hidden');
    historySection.classList.remove('hidden');
});

async function fetchHistory() {
    try {
        const res = await fetch('/api/crawls');
        const crawls = await res.json();
        renderHistory(crawls);
    } catch (err) {
        historyList.textContent = 'Failed to load history';
    }
}

function renderHistory(crawls) {
    historyList.innerHTML = '';
    if (crawls.length === 0) {
        historyList.innerHTML = '<p>No crawls yet.</p>';
        return;
    }

    crawls.forEach(crawl => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
            <span><strong>${crawl.root_url}</strong> (${crawl.status})</span>
            <span>${new Date(crawl.timestamp).toLocaleString()}</span>
        `;
        div.addEventListener('click', () => showDetails(crawl.id));
        historyList.appendChild(div);
    });
}

async function showDetails(id) {
    historySection.classList.add('hidden');
    detailsSection.classList.remove('hidden');
    resourcesList.innerHTML = 'Loading...';

    try {
        const res = await fetch(`/api/crawls/${id}`);
        const resources = await res.json();
        renderResources(resources);
    } catch (err) {
        resourcesList.textContent = 'Error loading details';
    }
}

function renderResources(resources) {
    if (resources.length === 0) {
        resourcesList.innerHTML = '<p>No resources found.</p>';
        return;
    }

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Status</th>
                    <th>Type</th>
                    <th>URL</th>
                    <th>Source Page</th>
                </tr>
            </thead>
            <tbody>
    `;

    resources.forEach(res => {
        const statusClass = `status-${res.status_code}`;
        html += `
            <tr>
                <td class="${statusClass}">${res.status_code}</td>
                <td>${res.type}</td>
                <td title="${res.url}">${res.url.substring(0, 50)}${res.url.length > 50 ? '...' : ''}</td>
                <td title="${res.source_page_url}">${res.source_page_url ? (res.source_page_url.substring(0, 30) + '...') : '-'}</td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    resourcesList.innerHTML = html;
}
