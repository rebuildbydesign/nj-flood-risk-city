// ========================================
// MAPBOX INITIALIZATION
// ========================================
mapboxgl.accessToken = 'pk.eyJ1IjoiajAwYnkiLCJhIjoiY2x1bHUzbXZnMGhuczJxcG83YXY4czJ3ayJ9.S5PZpU9VDwLMjoX_0x5FDQ';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/j00by/cmbqvtons000201qlgcox1gi5',
  center: [-74.4, 40.0], // NJ center — fitBounds takes over on load
  zoom: 7,
  maxBounds: [
    [-76.2, 38.5],   // SW corner (wider view of NJ)
    [-73.2, 41.8]    // NE corner (wider view of NJ)
  ],
  minZoom: 6.5
});

// Add navigation controls (zoom, rotate, pitch)
map.addControl(new mapboxgl.NavigationControl(), 'top-right');


// ========================================
// STATE VARIABLES
// ========================================
let activeYear = "2025";
let show2025 = true;
let show2050 = false;

// --- Deep-link: read ?city= URL parameter from county map ---
const _urlCityParam = new URLSearchParams(window.location.search).get('city');
const _validCities = ["NEWARK CITY","ELIZABETH CITY","CAMDEN CITY","TRENTON CITY",
                      "JERSEY CITY","PATERSON CITY","ASBURY PARK CITY","ATLANTIC CITY"];
let activeCity = (_urlCityParam && _validCities.includes(_urlCityParam))
    ? _urlCityParam
    : "NEWARK CITY";

// Sync dropdown immediately (script runs after DOM, so element is available)
const _selectEl = document.getElementById('municipality-select');
if (_selectEl) _selectEl.value = activeCity;

let popup = null;

// Boundary bounds cache - stores precomputed map bounds for each municipality
const boundaryBoundsByMun = {};

// Municipality label (now a finding card element)
let municipalityLabel = null; // kept for compatibility

// Track which asset types are toggled off
const hiddenAssetTypes = new Set();

// Blue Acres layer visibility
let blueAcresVisible = false;

// Map Blue Acres municipality names to app city keys
const blueAcresMunMap = {
  "Newark City": "NEWARK CITY",
  "Paterson City": "PATERSON CITY"
};

// Pre-cached Blue Acres parcel counts by municipality (from GeoJSON)
const blueAcresCounts = {
  "Newark City": 6,
  "Paterson City": 24
};
const blueAcresTotalCount = 1677;

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
  SOLIDHAZARD: "\uD83E\uDDEA",
  SOLIDWASTE: "\uD83D\uDDD1\uFE0F",
  SUPERFUND: "\uD83D\uDED1",
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
  // Hide all asset layers first
  ["assets_2025", "assets_2050"].forEach(id => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', 'none');
    }
  });

  // Show/hide floodplain layers based on toggle state
  if (map.getLayer('floodplain_2025')) {
    map.setLayoutProperty('floodplain_2025', 'visibility', show2025 ? 'visible' : 'none');
  }
  if (map.getLayer('floodplain_2050')) {
    map.setLayoutProperty('floodplain_2050', 'visibility', show2050 ? 'visible' : 'none');
  }

  // Filter floodplain layers to active municipality only
  ['floodplain_2025', 'floodplain_2050'].forEach(id => {
    if (map.getLayer(id)) {
      map.setFilter(id, ['==', ['get', 'MUN'], activeCity]);
    }
  });

  // Determine which asset layer to show based on active floodplain toggles
  // Priority: if 2050 is on, show 2050 assets (superset); else show 2025 assets
  if (show2050) {
    activeYear = '2050';
  } else if (show2025) {
    activeYear = '2025';
  }
  const visibleAssetId = `assets_${activeYear}`;

  // Show active asset layer (unless Blue Acres is on)
  map.setLayoutProperty(visibleAssetId, 'visibility', blueAcresVisible ? 'none' : 'visible');

  // Filter to active municipality (respecting hidden asset types)
  map.setFilter('boundary', ['==', ['get', 'MUN'], activeCity]);

  // Build asset filter including hidden types
  const assetFilters = ['all', ['==', ['get', 'MUN'], activeCity]];
  hiddenAssetTypes.forEach(type => {
    assetFilters.push(['!=', ['get', 'ASSET'], type]);
  });
  map.setFilter(visibleAssetId, assetFilters);

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

    // Update on-map findings overlay
    updateMapFindings(overallTotal, total2025, total2050, pctRisk2025, pctRisk2050);

    // Build legend (cards only — findings are on the map)
    legend.innerHTML = `
      <h3>Step 3: Explore Exposed Assets</h3>
      <p class="card-toggle-hint">Click a card to show/hide asset type</p>
      <div class="card-container"></div>
    `;

    const container = legend.querySelector('.card-container');

    // Sort by 2050 exposure percentage descending (highest risk first)
    const sortedTypes = [...allTypes].sort((a, b) => {
      const totalA = munTotals[a] || Math.max(counts2025[a] || 0, counts2050[a] || 0) || 1;
      const totalB = munTotals[b] || Math.max(counts2025[b] || 0, counts2050[b] || 0) || 1;
      const pctA = (counts2050[a] || 0) / totalA;
      const pctB = (counts2050[b] || 0) / totalB;
      return pctB - pctA;
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

  // Cities that need extra zoom boost (geographically smaller or elongated)
  const tightCities = ["NEWARK CITY","ELIZABETH CITY","TRENTON CITY",
                       "PATERSON CITY","ASBURY PARK CITY","ATLANTIC CITY"];
  const isTight = tightCities.includes(munName);

  map.stop();
  map.fitBounds(bounds, {
    padding: isMobile ? {
      top: 80,
      bottom: window.innerHeight * 0.55,
      left: 20,
      right: 20
    } : {
      top: isTight ? 10 : 20,
      bottom: isTight ? 10 : 20,
      left: 320,
      right: isTight ? 340 : 360
    },
    offset: isMobile ? [0, 0] : [isTight ? -40 : -60, 0],
    duration: 2000,
    linear: false,
    maxZoom: isMobile ? 12 : 18,
    essential: true
  });
}


// ========================================
// FINDING CARD - City name + key finding overlay
// Matches county project's KEY FINDING card style
// ========================================
function updateMunicipalityLabel() {
  const el = document.getElementById('finding-city-name');
  if (!el) return;
  const cityDisplayName = municipalityLabels[activeCity] || activeCity;
  el.textContent = cityDisplayName;
}

function updateMapFindings(overallTotal, total2025, total2050, pctRisk2025, pctRisk2050) {
  const el = document.getElementById('finding-text');
  if (!el) return;

  if (overallTotal === 0) {
    el.innerHTML = '';
    return;
  }

  const cityDisplayName = municipalityLabels[activeCity] || activeCity;

  // Narrative sentence form matching county project style
  el.innerHTML = `
    Of <strong>${overallTotal}</strong> public assets in ${cityDisplayName},
    <strong>${total2025}</strong> are in the floodplain today &mdash;
    <span class="finding-2050">rising to ${total2050} by 2050</span>
    (${pctRisk2050}% of all assets).
  `;
}

// Finding card close button
document.getElementById('finding-close')?.addEventListener('click', () => {
  const card = document.getElementById('finding-card');
  if (card) card.style.display = 'none';
});


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
      'line-color': 'rgb(255, 0, 0)',
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
        'fill-color': year === '2025' ? '#a5d5f1' : '#3a7fc3',
        'fill-opacity': 1
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
  
  // ---- Add Blue Acres polygon fill layer (between floodplains and assets) ----
  map.addSource('blueacres', {
    type: 'geojson',
    data: 'data/blueacres.geojson'
  });

  // Insert before asset layers so assets render on top
  // Using teal (#0d9488 / #14b8a6) to distinguish from Parks green (#3FB950)
  map.addLayer({
    id: 'blueacres-fill',
    type: 'fill',
    source: 'blueacres',
    paint: {
      'fill-color': '#0d9488',
      'fill-opacity': 0.45
    },
    layout: { visibility: 'none' }
  }, 'assets_2050');  // Insert before assets

  map.addLayer({
    id: 'blueacres-outline',
    type: 'line',
    source: 'blueacres',
    paint: {
      'line-color': '#0f766e',
      'line-width': 1.5,
      'line-opacity': 0.7
    },
    layout: { visibility: 'none' }
  }, 'assets_2050');  // Insert before assets

  // ---- Add Blue Acres clustered centroid layers (on top of everything) ----
  map.addSource('blueacres-centroids', {
    type: 'geojson',
    data: 'data/blueacres_centroids.geojson',
    cluster: true,
    clusterMaxZoom: 13,   // clusters dissolve at zoom 14+ (polygons take over)
    clusterRadius: 60
  });

  // Cluster circles — sized by point count
  map.addLayer({
    id: 'blueacres-clusters',
    type: 'circle',
    source: 'blueacres-centroids',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#0d9488',
      'circle-radius': [
        'step', ['get', 'point_count'],
        16,    // default radius
        10, 20,
        50, 26,
        100, 32,
        300, 38
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-opacity': 0.9
    },
    layout: { visibility: 'none' }
  });

  // Cluster count labels
  map.addLayer({
    id: 'blueacres-cluster-count',
    type: 'symbol',
    source: 'blueacres-centroids',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
      'text-size': 13,
      'text-allow-overlap': true,
      visibility: 'none'
    },
    paint: {
      'text-color': '#ffffff'
    }
  });

  // (No unclustered point layer — polygons handle individual parcels at high zoom)

  // ---- Click cluster to zoom in ----
  map.on('click', 'blueacres-clusters', e => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['blueacres-clusters'] });
    const clusterId = features[0].properties.cluster_id;
    map.getSource('blueacres-centroids').getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      map.easeTo({
        center: features[0].geometry.coordinates,
        zoom: zoom
      });
    });
  });

  map.on('mouseenter', 'blueacres-clusters', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'blueacres-clusters', () => {
    map.getCanvas().style.cursor = '';
  });

  // ---- Blue Acres hover popup ----
  map.on('mouseenter', 'blueacres-fill', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'blueacres-fill', () => {
    map.getCanvas().style.cursor = '';
    if (popup) popup.remove();
  });

  map.on('mousemove', 'blueacres-fill', e => {
    if (!e.features.length) return;
    const f = e.features[0];
    const name = f.properties.NAME_LABEL || f.properties.FEE_SIMPLE || 'Blue Acres Parcel';
    const use = f.properties.USE_LABEL || '';
    const acres = f.properties.GISACRES ? parseFloat(f.properties.GISACRES).toFixed(2) : '';
    const date = f.properties.PRESERVATI || '';
    const muni = f.properties.MUNICIPALI || '';

    if (popup) popup.remove();
    popup = new mapboxgl.Popup({ closeButton: false, offset: 10 })
      .setLngLat(e.lngLat)
      .setHTML(`
        <strong style="color:#0d9488">\u{1F33F} ${name}</strong><br/>
        ${muni}${use ? ' · ' + use : ''}<br/>
        ${acres ? acres + ' acres' : ''}${date ? ' · Preserved ' + date : ''}
      `)
      .addTo(map);
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
    if (blueAcresVisible) {
      updateBlueAcresHighlight();
      updateBlueAcresStats();
    }
  });
  
  // ---- Year toggle button events (independent on/off) ----
  document.getElementById('toggle-2025').onclick = () => {
    show2025 = !show2025;
    document.getElementById('toggle-2025').classList.toggle('active', show2025);
    loadLayers();
  };

  document.getElementById('toggle-2050').onclick = () => {
    show2050 = !show2050;
    document.getElementById('toggle-2050').classList.toggle('active', show2050);
    loadLayers();
  };
  
  // ---- Blue Acres button toggle event ----
  document.getElementById('toggle-blue-acres').onclick = () => {
    blueAcresVisible = !blueAcresVisible;
    document.getElementById('toggle-blue-acres').classList.toggle('active', blueAcresVisible);

    const vis = blueAcresVisible ? 'visible' : 'none';
    const assetVis = blueAcresVisible ? 'none' : 'visible';

    // Show/hide Blue Acres layers
    ['blueacres-fill', 'blueacres-outline', 'blueacres-clusters', 'blueacres-cluster-count'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });

    // Hide/show asset point layers (mutually exclusive with Blue Acres)
    if (map.getLayer(`assets_${activeYear}`)) {
      map.setLayoutProperty(`assets_${activeYear}`, 'visibility', assetVis);
    }

    if (blueAcresVisible) {
      updateBlueAcresHighlight();
    }
    updateBlueAcresStats();
  };

  // ---- Load CSV totals, then initial state ----
  loadMunicipalityTotals().then(() => {
    loadLayers();
  });
});

// ========================================
// BLUE ACRES HIGHLIGHT
// Updates fill opacity to emphasize parcels in active city
// ========================================
function updateBlueAcresHighlight() {
  if (!map.getLayer('blueacres-fill')) return;

  // Find the Blue Acres municipality name that matches the active city
  const matchingBaMun = Object.entries(blueAcresMunMap)
    .find(([_, appKey]) => appKey === activeCity);
  const baMunName = matchingBaMun ? matchingBaMun[0] : null;

  // Bright teal for parcels in the active city, muted for others
  map.setPaintProperty('blueacres-fill', 'fill-opacity', [
    'case',
    baMunName
      ? ['==', ['get', 'MUNICIPALI'], baMunName]
      : ['literal', false],
    0.65,  // highlighted
    0.25   // muted
  ]);

  map.setPaintProperty('blueacres-fill', 'fill-color', [
    'case',
    baMunName
      ? ['==', ['get', 'MUNICIPALI'], baMunName]
      : ['literal', false],
    '#0d9488',  // bright teal
    '#5eead4'   // lighter muted teal
  ]);

  map.setPaintProperty('blueacres-outline', 'line-opacity', [
    'case',
    baMunName
      ? ['==', ['get', 'MUNICIPALI'], baMunName]
      : ['literal', false],
    0.9,
    0.3
  ]);
}

// ========================================
// BLUE ACRES STATS
// Shows parcel count for active city vs statewide
// ========================================
function updateBlueAcresStats() {
  const statsEl = document.getElementById('blue-acres-stats');
  if (!statsEl) return;

  if (!blueAcresVisible) {
    statsEl.classList.add('hidden');
    return;
  }

  statsEl.classList.remove('hidden');

  // Use pre-cached counts (querySourceFeatures is viewport-dependent and unreliable)
  const total = blueAcresTotalCount;

  // Find matching Blue Acres municipality name for active city
  const matchingBaMun = Object.entries(blueAcresMunMap)
    .find(([_, appKey]) => appKey === activeCity);
  const baMunName = matchingBaMun ? matchingBaMun[0] : null;
  const cityCount = baMunName ? (blueAcresCounts[baMunName] || 0) : 0;

  const cityDisplayName = municipalityLabels[activeCity] || activeCity;

  if (cityCount > 0) {
    statsEl.innerHTML = `
      <span class="stat-highlight">${total.toLocaleString()}</span> parcels acquired statewide.
      <span class="stat-city">${cityDisplayName}</span> has
      <span class="stat-highlight">${cityCount}</span> Blue Acres parcel${cityCount !== 1 ? 's' : ''} (highlighted).
    `;
  } else {
    statsEl.innerHTML = `
      <span class="stat-highlight">${total.toLocaleString()}</span> parcels acquired statewide.
      <span class="stat-city">${cityDisplayName}</span> has no Blue Acres parcels yet.
    `;
  }
}

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

// ========================================
// FLOATING TOOLTIP - positioned over map on hover
// ========================================
const floatingTooltip = document.getElementById('floating-tooltip');

document.querySelectorAll('.tooltip-wrap').forEach(wrap => {
  const tipText = wrap.querySelector('.tooltip')?.textContent || '';

  wrap.addEventListener('mouseenter', () => {
    const rect = wrap.getBoundingClientRect();
    floatingTooltip.textContent = tipText;

    // Position to the right of the button, vertically centered
    const left = rect.right + 12;
    const top = rect.top + rect.height / 2;

    floatingTooltip.style.left = left + 'px';
    floatingTooltip.style.top = top + 'px';
    floatingTooltip.style.transform = 'translateY(-50%)';
    floatingTooltip.classList.add('visible');
  });

  wrap.addEventListener('mouseleave', () => {
    floatingTooltip.classList.remove('visible');
  });
});

