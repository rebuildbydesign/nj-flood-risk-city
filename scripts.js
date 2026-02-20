// ========================================
// MAPBOX INITIALIZATION
// ========================================
mapboxgl.accessToken = 'pk.eyJ1IjoiajAwYnkiLCJhIjoiY2x1bHUzbXZnMGhuczJxcG83YXY4czJ3ayJ9.S5PZpU9VDwLMjoX_0x5FDQ';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/j00by/cml8tkndp003e01qofxow4fbd',
  center: [-74.1724, 40.7357], // Newark default
  zoom: 12
});

// Add navigation controls (zoom, rotate, pitch)
map.addControl(new mapboxgl.NavigationControl(), 'top-right');


// ========================================
// STATE VARIABLES
// ========================================
let activeYear = "2025";
let activeCity = "NEWARK CITY";
let popup = null;

// Boundary bounds cache - stores precomputed map bounds for each municipality
const boundaryBoundsByMun = {};

// Municipality label marker on the map
let municipalityLabel = null;

// Track which asset types are toggled off
const hiddenAssetTypes = new Set();

// ========================================
// ASSET COLORS - Map data types to colors
// ========================================
const colors = {
  AIRPORT: "#111111",
  HOSPITAL: "#D7263D",
  KCS: "#FF8700",
  LIBRARY: "#FFD100",
  PARK: "#3FB950",
  POWERPLANT: "#8C1EFF",
  SCHOOL: "#FF5EBF",
  SOLIDHAZARD: "#A15500",
  SOLIDWASTE: "#FF3D00",
  SUPERFUND: "#C10087",
  WASTEWATER: "#5A5A5A"
};

// ========================================
// ASSET LABELS - User-friendly display names
// ========================================
const assetLabels = {
  AIRPORT: "Aviation Facilities",
  HOSPITAL: "Hospitals",
  KCS: "Contaminated Sites",
  LIBRARY: "Libraries",
  PARK: "Parks",
  POWERPLANT: "Power Plants",
  SCHOOL: "Schools",
  SOLIDHAZARD: "Solid & Hazardous Waste",
  SOLIDWASTE: "Solid Waste Landfills",
  SUPERFUND: "Superfund Sites",
  WASTEWATER: "Wastewater Treatment"
};

// ========================================
// ASSET EMOJIS - Icon for each asset type
// ========================================
const assetEmojis = {
  AIRPORT: "\u2708\uFE0F",
  HOSPITAL: "\uD83C\uDFE5",
  KCS: "\u26A0\uFE0F",
  LIBRARY: "\uD83D\uDCDA",
  PARK: "\uD83C\uDF33",
  POWERPLANT: "\u26A1",
  SCHOOL: "\uD83C\uDFEB",
  SOLIDHAZARD: "\u2623\uFE0F",
  SOLIDWASTE: "\uD83D\uDDD1\uFE0F",
  SUPERFUND: "\u2622\uFE0F",
  WASTEWATER: "\uD83D\uDEB0"
};

// ========================================
// MUNICIPALITY DISPLAY NAMES - Clean labels for legend
// ========================================
const municipalityLabels = {
  "NEWARK CITY": "Newark",
  "ELIZABETH CITY": "Elizabeth",
  "CAMDEN CITY": "Camden",
  "TRENTON CITY": "Trenton",
  "JERSEY CITY": "Jersey City",
  "PATERSON CITY": "Paterson",
  "ASBURY PARK CITY": "Asbury Park",
  "ATLANTIC CITY": "Atlantic City"
};

// ========================================
// CSV ASSET NAME → APP KEY MAPPING
// ========================================
const csvAssetKeyMap = {
  "AIRPORT": "AIRPORT",
  "HOSPITAL": "HOSPITAL",
  "KNOWN CONTAMINATED SITE": "KCS",
  "LIBRARY": "LIBRARY",
  "PARK": "PARK",
  "POWERPLANT": "POWERPLANT",
  "SCHOOL": "SCHOOL",
  "SOLID & HAZARD": "SOLIDHAZARD",
  "SOLID WASTE LANDFILL": "SOLIDWASTE",
  "SUPERFUND": "SUPERFUND",
  "WASTEWATER TREATMENT": "WASTEWATER"
};

// CSV municipality name → app activeCity key
const csvMunKeyMap = {
  "Newark": "NEWARK CITY",
  "Elizabeth": "ELIZABETH CITY",
  "Camden": "CAMDEN CITY",
  "Trenton": "TRENTON CITY",
  "Jersey City": "JERSEY CITY",
  "Paterson": "PATERSON CITY",
  "Asbury Park City": "ASBURY PARK CITY",
  "Atlantic City": "ATLANTIC CITY"
};

// ========================================
// MUNICIPALITY TOTALS - loaded from CSV
// Structure: { "NEWARK CITY": { "KCS": 510, "SCHOOL": 121, ... }, ... }
// ========================================
const municipalityTotals = {};

function loadMunicipalityTotals() {
  return fetch('data/8_municipality_findings.csv')
    .then(res => res.text())
    .then(text => {
      const lines = text.split('\n');
      let currentMun = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = [];
        let current = '';
        let inQuotes = false;
        for (let c = 0; c < line.length; c++) {
          if (line[c] === '"') { inQuotes = !inQuotes; }
          else if (line[c] === ',' && !inQuotes) { cols.push(current.trim()); current = ''; }
          else { current += line[c]; }
        }
        cols.push(current.trim());

        // Check if this line is a municipality header (single value in first col, rest empty)
        if (cols[0] && !cols[1] && !cols[2] && !cols[3] && !cols[4] && !cols[5]) {
          const munName = cols[0];
          if (munName !== 'Overall' && csvMunKeyMap[munName]) {
            currentMun = csvMunKeyMap[munName];
            municipalityTotals[currentMun] = {};
          }
          continue;
        }

        // Skip header rows and "Overall" rows
        if (cols[0] === 'Public Asset' || cols[0] === 'Overall' || !currentMun) continue;

        // Parse asset row: Asset Name, Total Count, 2025 Risk, % 2025, 2050 Risk, % 2050, Findings
        const csvAssetName = cols[0];
        const totalCount = parseInt(cols[1]) || 0;
        const appKey = csvAssetKeyMap[csvAssetName];

        if (appKey && totalCount > 0) {
          municipalityTotals[currentMun][appKey] = totalCount;
        }
      }
      console.log('Municipality totals loaded:', municipalityTotals);
    })
    .catch(err => console.warn('Could not load municipality totals CSV:', err));
}

// ========================================
// LAYER VISIBILITY CONTROL
// Toggle between 2025 and 2050 scenarios
// ========================================
function loadLayers() {
  const assetId = `assets_${activeYear}`;

  // Hide all layers first
  ["floodplain_2025", "floodplain_2050", "assets_2025", "assets_2050"].forEach(id => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', 'none');
    }
  });

  // Show floodplain layers:
  // - 2025 selected: only 2025 floodplain
  // - 2050 selected: both floodplains (2050 underneath, 2025 on top to show overlap)
  if (activeYear === '2050') {
    map.setLayoutProperty('floodplain_2050', 'visibility', 'visible');
    map.setLayoutProperty('floodplain_2025', 'visibility', 'visible');
  } else {
    map.setLayoutProperty('floodplain_2025', 'visibility', 'visible');
  }

  // Filter floodplain layers to active municipality only
  ['floodplain_2025', 'floodplain_2050'].forEach(id => {
    if (map.getLayer(id)) {
      map.setFilter(id, ['==', ['get', 'MUN'], activeCity]);
    }
  });

  // Show active year asset layer
  map.setLayoutProperty(assetId, 'visibility', 'visible');

  // Filter to active municipality (respecting hidden asset types)
  map.setFilter('boundary', ['==', ['get', 'MUN'], activeCity]);

  // Build asset filter including hidden types
  const assetFilters = ['all', ['==', ['get', 'MUN'], activeCity]];
  hiddenAssetTypes.forEach(type => {
    assetFilters.push(['!=', ['get', 'ASSET'], type]);
  });
  map.setFilter(assetId, assetFilters);

  // Update legend after map finishes rendering
  map.once('idle', () => updateLegend());
}

// ========================================
// QUERY FEATURES FOR A GIVEN YEAR
// Returns deduplicated features for a municipality
// ========================================
function getFeaturesForYear(year) {
  const assetId = `assets_${year}`;
  const layer = map.getLayer(assetId);
  if (!layer) return [];

  const rawFeatures = map.querySourceFeatures(layer.source, {
    filter: ['==', ['get', 'MUN'], activeCity]
  });

  const uniqueFeatures = {};
  rawFeatures.forEach(f => {
    const id = f.properties.UNIQUE_ID;
    if (id) uniqueFeatures[id] = f;
  });
  return Object.values(uniqueFeatures);
}

// ========================================
// COUNT ASSETS BY TYPE
// ========================================
function countByType(features) {
  const counts = {};
  features.forEach(f => {
    const type = f.properties.ASSET;
    counts[type] = (counts[type] || 0) + 1;
  });
  return counts;
}

// ========================================
// UPDATE LEGEND
// Card-based layout with paired bars for 2025 vs 2050
// ========================================
function updateLegend() {
  const legend = document.getElementById('legend');
  if (!legend) return;

  // Temporarily make both layers visible to query tiles
  ['assets_2025', 'assets_2050'].forEach(id => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', 'visible');
    }
  });

  // Wait for tiles to load for both layers
  map.once('idle', () => {
    const features2025 = getFeaturesForYear('2025');
    const features2050 = getFeaturesForYear('2050');
    const counts2025 = countByType(features2025);
    const counts2050 = countByType(features2050);

    const total2025 = features2025.length;
    const total2050 = features2050.length;

    // Restore visibility — hide the inactive asset layer
    const inactiveYear = activeYear === '2025' ? '2050' : '2025';
    if (map.getLayer(`assets_${inactiveYear}`)) {
      map.setLayoutProperty(`assets_${inactiveYear}`, 'visibility', 'none');
    }

    // Get totals for the active municipality from CSV data
    const munTotals = municipalityTotals[activeCity] || {};

    // All unique asset types across both years AND totals
    const allTypes = new Set([
      ...Object.keys(counts2025),
      ...Object.keys(counts2050),
      ...Object.keys(munTotals)
    ]);

    const cityDisplayName = municipalityLabels[activeCity] || activeCity;

    // Compute overall totals for header
    let overallTotal = 0;
    allTypes.forEach(type => { overallTotal += (munTotals[type] || 0); });

    const pctRisk2025 = overallTotal > 0 ? ((total2025 / overallTotal) * 100).toFixed(1) : '0';
    const pctRisk2050 = overallTotal > 0 ? ((total2050 / overallTotal) * 100).toFixed(1) : '0';

    // Build legend header
    legend.innerHTML = `
      <h3>Step 3: Exposure by Asset Type</h3>
      <p class="legend-helper">
        <strong>${cityDisplayName}</strong> has <strong>${overallTotal}</strong> public assets.
        <strong>${pctRisk2025}%</strong> (${total2025}) at risk in 2025 \u2192
        <strong>${pctRisk2050}%</strong> (${total2050}) by 2050.
      </p>
      <div class="bar-legend-key">
        <span class="bar-key-item"><span class="bar-key-swatch bar-key-2025"></span>2025 Floodplain</span>
        <span class="bar-key-item"><span class="bar-key-swatch bar-key-2050"></span>2050 Floodplain</span>
      </div>
      <p class="card-toggle-hint">Click any card to toggle its layer on/off the map</p>
      <div class="card-container"></div>
    `;

    const container = legend.querySelector('.card-container');

    // Sort by 2050 count descending (most at-risk first)
    const sortedTypes = [...allTypes].sort((a, b) => {
      return (counts2050[b] || 0) - (counts2050[a] || 0);
    });

    sortedTypes.forEach(type => {
      const color = colors[type] || '#999';
      const label = assetLabels[type] || type;
      const emoji = assetEmojis[type] || '';
      const c2025 = counts2025[type] || 0;
      const c2050 = counts2050[type] || 0;
      const total = munTotals[type] || Math.max(c2025, c2050) || 1;
      const isVisible = !hiddenAssetTypes.has(type);

      // Bar width = percentage of total assets of this type
      const pct2025 = (c2025 / total) * 100;
      const pct2050 = (c2050 / total) * 100;

      const card = document.createElement('div');
      card.className = 'asset-card' + (isVisible ? '' : ' asset-card-off');
      card.dataset.assetType = type;
      card.style.borderLeftColor = color;
      card.title = `Click to ${isVisible ? 'hide' : 'show'} ${label} on map`;
      card.innerHTML = `
        <div class="card-header">
          <span class="card-emoji">${emoji}</span>
          <span class="card-title">${label}</span>
        </div>
        <div class="card-bars">
          <div class="card-bar-row">
            <span class="card-bar-label">2025</span>
            <div class="card-bar-track">
              <div class="card-bar-fill bar-2025" style="width:${Math.max(pct2025, 2)}%"></div>
            </div>
            <span class="card-bar-count">${c2025}/${total}</span>
          </div>
          <div class="card-bar-row">
            <span class="card-bar-label">2050</span>
            <div class="card-bar-track">
              <div class="card-bar-fill bar-2050" style="width:${Math.max(pct2050, 2)}%"></div>
            </div>
            <span class="card-bar-count">${c2050}/${total}</span>
          </div>
        </div>
      `;
      container.appendChild(card);
    });

    // Click-to-toggle cards
    container.querySelectorAll('.asset-card').forEach(card => {
      card.addEventListener('click', () => {
        const type = card.dataset.assetType;
        if (hiddenAssetTypes.has(type)) {
          hiddenAssetTypes.delete(type);
          card.classList.remove('asset-card-off');
        } else {
          hiddenAssetTypes.add(type);
          card.classList.add('asset-card-off');
        }
        applyAssetFilter();
      });
    });
  });
}

// ========================================
// APPLY ASSET FILTER
// Updates map filter to hide/show asset types
// ========================================
function applyAssetFilter() {
  const assetId = `assets_${activeYear}`;
  if (!map.getLayer(assetId)) return;

  const filters = ['all', ['==', ['get', 'MUN'], activeCity]];

  if (hiddenAssetTypes.size > 0) {
    // Exclude hidden types
    hiddenAssetTypes.forEach(type => {
      filters.push(['!=', ['get', 'ASSET'], type]);
    });
  }

  map.setFilter(assetId, filters);
}


// ========================================
// ZOOM TO MUNICIPALITY
// Fits map viewport to selected municipality boundary
// ========================================
function zoomToMunicipality(munName) {
  const bounds = boundaryBoundsByMun[munName];
  if (!bounds) return;
  
  // Detect mobile
  const isMobile = window.innerWidth <= 768;
  
  map.stop();
  map.fitBounds(bounds, {
    padding: isMobile ? {
      top: 80,
      bottom: window.innerHeight * 0.55, // Account for 50vh sidebar + toggle
      left: 20,
      right: 20
    } : {
      top: 60,
      bottom: 60,
      left: 340,   // Account for sidebar width on desktop
      right: 60
    },
    offset: isMobile ? [0, 0] : [-50, 0],
    duration: 2000,
    linear: false,
    maxZoom: isMobile ? 12 : 14, // Lower max zoom on mobile for better overview
    essential: true
  });
}


// ========================================
// MUNICIPALITY LABEL ON MAP
// Places city name inside the boundary
// ========================================
function updateMunicipalityLabel() {
  // Remove existing label
  if (municipalityLabel) {
    municipalityLabel.remove();
    municipalityLabel = null;
  }

  const bounds = boundaryBoundsByMun[activeCity];
  if (!bounds) return;

  const cityDisplayName = municipalityLabels[activeCity] || activeCity;

  // Position label at top-left area inside the boundary
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const labelLng = sw.lng + (ne.lng - sw.lng) * 0.05;
  const labelLat = ne.lat - (ne.lat - sw.lat) * 0.05;

  const el = document.createElement('div');
  el.className = 'municipality-map-label';
  el.textContent = cityDisplayName;

  municipalityLabel = new mapboxgl.Marker({ element: el, anchor: 'top-left' })
    .setLngLat([labelLng, labelLat])
    .addTo(map);
}


// ========================================
// MAP LOAD EVENT
// Initialize all map layers and event listeners
// ========================================
map.on('load', () => {
  
  // ---- Add municipality boundary layer ----
  map.addSource('boundary', {
    type: 'geojson',
    data: 'data/boundary.json'
  });
  
  map.addLayer({
    id: 'boundary',
    type: 'line',
    source: 'boundary',
    paint: {
      'line-color': 'rgba(255, 0, 0, 0.6)',
      'line-width': 3,
      'line-dasharray': [2, 2]
    },
    filter: ['==', ['get', 'MUN'], activeCity]
  });
  
  // ---- Precompute boundary bounds for zoom function ----
  fetch('data/boundary.json')
    .then(res => res.json())
    .then(geojson => {
      geojson.features.forEach(f => {
        const mun = f.properties?.MUN;
        if (!mun) return;
        
        const bounds = new mapboxgl.LngLatBounds();
        const geom = f.geometry;
        
        if (geom.type === 'Polygon') {
          geom.coordinates[0].forEach(c => bounds.extend(c));
        }
        if (geom.type === 'MultiPolygon') {
          geom.coordinates.forEach(p =>
            p[0].forEach(c => bounds.extend(c))
          );
        }
        
        boundaryBoundsByMun[mun] = bounds;
      });
      
      // Initial zoom after bounds are ready
      zoomToMunicipality(activeCity);
      updateMunicipalityLabel();
    });
  
  // ---- Add floodplain layers first (bottom), then asset layers (top) ----
  // This ensures asset points always render above ALL floodplain fills.
  // Floodplain order: 2050 first (bottom), 2025 second (above 2050)
  ['2050', '2025'].forEach(year => {
    map.addSource(`floodplain_${year}`, {
      type: 'geojson',
      data: `data/floodplain_${year}.json`
    });

    map.addLayer({
      id: `floodplain_${year}`,
      type: 'fill',
      source: `floodplain_${year}`,
      paint: {
        'fill-color': year === '2025' ? '#a5d5f1' : '#3a7fc3'
      },
      layout: { visibility: year === '2025' ? 'visible' : 'none' }
    });
  });

  // ---- Add asset point layers on top of all floodplains ----
  const isMobile = window.innerWidth <= 768;

  ['2050', '2025'].forEach(year => {
    map.addSource(`assets_${year}`, {
      type: 'geojson',
      data: `data/assets_${year}.geojson`
    });

    map.addLayer({
      id: `assets_${year}`,
      type: 'circle',
      source: `assets_${year}`,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8, isMobile ? 3 : 4,
          12, isMobile ? 5 : 6,
          16, isMobile ? 7 : 9
        ],
        'circle-color': [
          'match',
          ['get', 'ASSET'],
          ...Object.entries(colors).flat(),
          '#cccccc'
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': isMobile ? 0.5 : 1,
        'circle-opacity': isMobile ? 0.9 : 1,
        'circle-stroke-opacity': isMobile ? 0.8 : 1
      },
      layout: { visibility: year === '2025' ? 'visible' : 'none' },
      filter: ['==', ['get', 'MUN'], activeCity]
    });
  });
  
  // ---- Hover popup on asset points ----
  map.on('mousemove', e => {
    // FIXED: Add proper array syntax
    const features = map.queryRenderedFeatures(e.point, {
      layers: [`assets_${activeYear}`]
    });
    
    map.getCanvas().style.cursor = features.length ? 'pointer' : '';
    
    if (popup) popup.remove();
    
    if (features.length) {
      const f = features[0];
      const name = f.properties.NAME
        ? f.properties.NAME.toUpperCase()
        : '';
      
      // FIXED: Add parentheses for function call
      popup = new mapboxgl.Popup({ closeButton: false })
        .setLngLat(f.geometry.coordinates)
        .setHTML(`<strong>${name}</strong>`)
        .addTo(map);
    }
  });
  
  map.on('mouseleave', 'assets_2025', () => popup && popup.remove());
  map.on('mouseleave', 'assets_2050', () => popup && popup.remove());
  
  // ---- Municipality dropdown event ----
  document.getElementById('municipality-select').addEventListener('change', e => {
    activeCity = e.target.value;
    loadLayers();
    zoomToMunicipality(activeCity);
    updateMunicipalityLabel();
  });
  
  // ---- Year toggle button events ----
  document.getElementById('toggle-2025').onclick = () => {
    activeYear = '2025';
    document.getElementById('toggle-2025').classList.add('active');
    document.getElementById('toggle-2050').classList.remove('active');
    loadLayers();
  };
  
  document.getElementById('toggle-2050').onclick = () => {
    activeYear = '2050';
    document.getElementById('toggle-2050').classList.add('active');
    document.getElementById('toggle-2025').classList.remove('active');
    loadLayers();
  };
  
  // ---- Load CSV totals, then initial state ----
  loadMunicipalityTotals().then(() => {
    loadLayers();
  });
});

// ========================================
// CSV DOWNLOAD FUNCTIONALITY
// Exports both 2025 and 2050 scenario data
// ========================================
document.getElementById('download-csv').addEventListener('click', () => {
  // Temporarily show both asset layers so querySourceFeatures works for both
  ['assets_2025', 'assets_2050'].forEach(id => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', 'visible');
    }
  });

  // Wait for tiles to load, then export
  map.once('idle', () => {
    const headers = [
      'Asset_Name',
      'Asset_Type',
      'County',
      'Municipality',
      'Unique_ID',
      'Flood_Scenario',
      'Longitude',
      'Latitude'
    ];

    let csvContent = headers.join(',') + '\n';
    let totalCount = 0;

    // Loop through both scenarios
    ['2025', '2050'].forEach(year => {
      const assetId = `assets_${year}`;
      const layer = map.getLayer(assetId);
      if (!layer) return;

      const sourceId = layer.source;

      const rawFeatures = map.querySourceFeatures(sourceId, {
        filter: ['==', ['get', 'MUN'], activeCity]
      });

      // Deduplicate by UNIQUE_ID within each year
      const uniqueFeatures = {};
      rawFeatures.forEach(f => {
        const id = f.properties.UNIQUE_ID;
        if (id) uniqueFeatures[id] = f;
      });

      const features = Object.values(uniqueFeatures);
      totalCount += features.length;

      features.forEach(f => {
        const props = f.properties;
        const coords = f.geometry.coordinates;

        const name = (props.NAME || 'Unknown').replace(/,/g, ';');
        const assetType = assetLabels[props.ASSET] || props.ASSET || 'Unknown';
        const county = (props.COUNTY || 'Unknown').replace(/,/g, ';');
        const municipality = municipalityLabels[props.MUN] || props.MUN || 'Unknown';
        const uniqueId = props.UNIQUE_ID || 'Unknown';
        const scenario = year;
        const longitude = coords[0].toFixed(6);
        const latitude = coords[1].toFixed(6);

        const row = [
          name,
          assetType,
          county,
          municipality,
          uniqueId,
          scenario,
          longitude,
          latitude
        ];

        csvContent += row.join(',') + '\n';
      });
    });

    // Restore visibility — call loadLayers to reset proper state
    loadLayers();

    if (totalCount === 0) {
      alert('No exposed assets found for this municipality');
      return;
    }

    // Create download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const cityName = municipalityLabels[activeCity] || activeCity;
    const cleanCityName = cityName.replace(/\s+/g, '_');
    const filename = `${cleanCityName}_2025_2050_flood_exposed_assets.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
});



// ========================================
// METHODOLOGY POPUP CONTROLS
// ========================================
const methodologyLink = document.getElementById('methodology-link');
const methodologyPopup = document.getElementById('methodology-popup');
const closeMethodology = document.getElementById('close-methodology');

// Open popup
methodologyLink.addEventListener('click', e => {
  e.preventDefault();
  methodologyPopup.classList.remove('hidden');
});

// Close popup via button
closeMethodology.addEventListener('click', () => {
  methodologyPopup.classList.add('hidden');
});

// Close popup by clicking outside
methodologyPopup.addEventListener('click', e => {
  if (e.target === methodologyPopup) {
    methodologyPopup.classList.add('hidden');
  }
});

