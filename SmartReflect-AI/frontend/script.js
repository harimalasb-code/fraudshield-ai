document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Map
    const map = L.map('map').setView([28.7041, 77.1025], 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO'
    }).addTo(map);

    const mapMarkers = [];

    // 2. Initialize Chart
    const ctx = document.getElementById('trendsChart').getContext('2d');
    const trendsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['High', 'Medium', 'Low'],
            datasets: [{
                label: 'Visibility Count',
                data: [0, 0, 0],
                backgroundColor: [
                    'rgba(16, 185, 129, 0.8)', // Green
                    'rgba(245, 158, 11, 0.8)', // Yellow
                    'rgba(239, 68, 68, 0.8)'   // Red
                ],
                borderWidth: 0,
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#94a3b8'} },
                x: { grid: { display: false }, ticks: { color: '#94a3b8'} }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });

    // Chart Data Trackers
    let countHigh = 0;
    let countMedium = 0;
    let countLow = 0;
    let totalDetections = 0;

    // Elements
    const runSimBtn = document.getElementById('runSimBtn');
    const simSpinner = document.getElementById('simSpinner');
    const currentStatus = document.getElementById('currentStatus');
    const confidenceValue = document.getElementById('confidenceValue');
    const gpsValue = document.getElementById('gpsValue');
    const currentKm = document.getElementById('currentKm');
    const detectionsCount = document.getElementById('detectionsCount');
    const alertList = document.getElementById('alertList');
    const reportsTableBody = document.querySelector('#reportsTable tbody');
    let hasAlerts = false;

    // 3. API Logic
    runSimBtn.addEventListener('click', async () => {
        runSimBtn.disabled = true;
        simSpinner.classList.add('active');

        try {
            const response = await fetch('http://127.0.0.1:8000/analyze');
            if(!response.ok) throw new Error("Backend not responding");
            const data = await response.json();
            updateDashboard(data);
        } catch (error) {
            console.warn("FastAPI backend not running, simulating mock data fallback...", error);
            simulateMockDataLocally();
        } finally {
            runSimBtn.disabled = false;
            simSpinner.classList.remove('active');
        }
    });

    function simulateMockDataLocally() {
        const levels = ["High", "Medium", "Low"];
        const vis = levels[Math.floor(Math.random() * levels.length)];
        let conf;
        if(vis === "High") conf = (85 + Math.random()*14).toFixed(2);
        else if(vis === "Medium") conf = (70 + Math.random()*14).toFixed(2);
        else conf = (40 + Math.random()*29).toFixed(2);

        updateDashboard({
            visibility_level: vis,
            confidence_score: parseFloat(conf),
            gps: { lat: 28.7041 + (Math.random() - 0.5)*0.1, lng: 77.1025 + (Math.random() - 0.5)*0.1 },
            km_marker: Math.floor(Math.random() * 200) + 10
        });
    }

    function updateDashboard(data) {
        // UI Updates
        currentStatus.textContent = data.visibility_level + " Visibility";
        currentStatus.className = "status-indicator"; 
        if(data.visibility_level === "High") currentStatus.classList.add("status-high");
        else if(data.visibility_level === "Medium") currentStatus.classList.add("status-medium");
        else currentStatus.classList.add("status-low");

        confidenceValue.textContent = data.confidence_score + "%";
        gpsValue.textContent = `${data.gps.lat.toFixed(4)}, ${data.gps.lng.toFixed(4)}`;
        currentKm.textContent = data.km_marker;
        totalDetections++;
        detectionsCount.textContent = totalDetections;

        // Map Update
        map.setView([data.gps.lat, data.gps.lng], 13);
        let markerColor = data.visibility_level === "High" ? "#10b981" : (data.visibility_level === "Medium" ? "#f59e0b" : "#ef4444");
        
        const circleMarker = L.circleMarker([data.gps.lat, data.gps.lng], {
            color: markerColor,
            fillColor: markerColor,
            fillOpacity: 0.8,
            radius: 8
        }).addTo(map);
        circleMarker.bindPopup(`<b>KM ${data.km_marker}</b><br>Status: ${data.visibility_level}<br>Conf: ${data.confidence_score}%`).openPopup();
        mapMarkers.push(circleMarker);

        // Chart Update
        if(data.visibility_level === "High") countHigh++;
        else if(data.visibility_level === "Medium") countMedium++;
        else countLow++;

        trendsChart.data.datasets[0].data = [countHigh, countMedium, countLow];
        trendsChart.update();

        // Table Update
        const now = new Date();
        const timeStr = now.toLocaleTimeString();
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${timeStr}</td>
            <td>KM ${data.km_marker} <br><span style="font-size:0.8rem;color:#94a3b8;">${data.gps.lat.toFixed(4)}, ${data.gps.lng.toFixed(4)}</span></td>
            <td><span class="status-indicator status-${data.visibility_level.toLowerCase()}">${data.visibility_level}</span></td>
            <td>${data.confidence_score}%</td>
        `;
        reportsTableBody.prepend(tr);

        if(reportsTableBody.children.length > 20) {
            reportsTableBody.lastElementChild.remove();
        }

        // Alerts Mechanism
        if(!hasAlerts) {
            alertList.innerHTML = '';
            hasAlerts = true;
        }

        if(data.visibility_level === "Low" || data.visibility_level === "Medium") {
            const alertClass = data.visibility_level === "Low" ? "danger" : "warning";
            const alertDiv = document.createElement('div');
            alertDiv.className = `alert-item ${alertClass}`;
            alertDiv.innerHTML = `
                <div>
                    <i class="fa-solid fa-triangle-exclamation"></i> ${data.visibility_level === "Low"? "Critical Alert: " : "Warning: "}
                    ${data.visibility_level} Visibility at KM ${data.km_marker}
                </div>
                <div class="alert-time">${timeStr}</div>
            `;
            alertList.prepend(alertDiv);
            
            if(alertList.children.length > 5) {
                alertList.lastElementChild.remove();
            }
        }
    }

    // 4. Tab Navigation Logic
    const navTabs = document.querySelectorAll('.nav-tab');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const topBarTitle = document.querySelector('.topbar h2');

    navTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active class from all tabs & panes
            navTabs.forEach(t => t.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));
            
            // Add active class to clicked tab and pane
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');

            // Update top bar title
            if(targetId === 'tab-overview') topBarTitle.textContent = "Live Monitoring";
            if(targetId === 'tab-map') topBarTitle.textContent = "GPS Map Tracking";
            if(targetId === 'tab-analytics') topBarTitle.textContent = "System Analytics";
            if(targetId === 'tab-reports') topBarTitle.textContent = "Full Detections Report";

            // Fix map un-rendering issue when the div becomes visible again
            if(targetId === 'tab-map') {
                setTimeout(() => map.invalidateSize(), 50);
            }
        });
    });
});
