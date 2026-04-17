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

// Sync both dropdowns immediately (script runs after DOM, so elements are available)
const _selectEl = document.getElementById('municipality-select');
if (_selectEl) _selectEl.value = activeCity;
const _mobileSelectEl = document.getElementById('mobile-municipality-select');
if (_mobileSelectEl) _mobileSelectEl.value = activeCity;

let popup = null;

// Boundary bounds cache - stores precomputed map bounds for each municipality
const boundaryBoundsByMun = {};
const boundaryFeaturesByMun = {};

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
  FIRE: "#E63946",
  HOSPITAL: "#D7263D",
  KCS: "#FF8700",
  LIBRARY: "#FFD100",
  PARK: "#3FB950",
  POLICE: "#1D4ED8",
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
  AIRPORT: "Airports Facilities",
  FIRE: "Fire Departments",
  HOSPITAL: "Hospitals Facilities",
  KCS: "Contaminated Sites",
  LIBRARY: "Libraries",
  PARK: "Parks",
  POLICE: "Police Stations",
  POWERPLANT: "Power Plants",
  SCHOOL: "Schools",
  SOLIDHAZARD: "Solid & Hazardous Waste",
  SOLIDWASTE: "Solid Waste Landfills",
  SUPERFUND: "Superfund Sites",
  WASTEWATER: "Wastewater Treatment"
};

const allAssetTypes = Object.keys(assetLabels);

// ========================================
// ASSET EMOJIS - Icon for each asset type
// ========================================
const assetEmojis = {
  AIRPORT: "\u2708\uFE0F",
  FIRE: "\uD83D\uDE92",
  HOSPITAL: "\uD83C\uDFE5",
  KCS: "\u26A0\uFE0F",
  LIBRARY: "\uD83D\uDCDA",
  PARK: "\uD83C\uDF33",
  POLICE: "\uD83D\uDE94",
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

const municipalityFactSheetUrls = {
  "NEWARK CITY": "https://rebuildbydesign.github.io/NJ-City-Fact-Sheet/?city=Newark",
  "ASBURY PARK CITY": "https://rebuildbydesign.github.io/NJ-City-Fact-Sheet/?city=Asbury+Park+City",
  "ATLANTIC CITY": "https://rebuildbydesign.github.io/NJ-City-Fact-Sheet/?city=Atlantic+City",
  "CAMDEN CITY": "https://rebuildbydesign.github.io/NJ-City-Fact-Sheet/?city=Camden",
  "ELIZABETH CITY": "https://rebuildbydesign.github.io/NJ-City-Fact-Sheet/?city=Elizabeth",
  "JERSEY CITY": "https://rebuildbydesign.github.io/NJ-City-Fact-Sheet/?city=Jersey+City",
  "PATERSON CITY": "https://rebuildbydesign.github.io/NJ-City-Fact-Sheet/?city=Paterson",
  "TRENTON CITY": "https://rebuildbydesign.github.io/NJ-City-Fact-Sheet/?city=Trenton"
};

const factSheetStatusTimeouts = {};

const normalizedCityKeyLookup = {};
Object.entries(municipalityLabels).forEach(([cityKey, label]) => {
  normalizedCityKeyLookup[normalizeCityName(cityKey)] = cityKey;
  normalizedCityKeyLookup[normalizeCityName(label)] = cityKey;
});

// ========================================
// CSV ASSET NAME → APP KEY MAPPING
// ========================================
const csvAssetKeyMap = {
  "AIRPORT": "AIRPORT",
  "FIRE DEPARTMENT": "FIRE",
  "HOSPITAL": "HOSPITAL",
  "KNOWN CONTAMINATED SITE": "KCS",
  "LIBRARY": "LIBRARY",
  "PARK": "PARK",
  "POLICE STATION": "POLICE",
  "POWERPLANT": "POWERPLANT",
  "SCHOOL": "SCHOOL",
  "SOLID & HAZARD": "SOLIDHAZARD",
  "SOLID WASTE LANDFILL": "SOLIDWASTE",
  "SUPERFUND": "SUPERFUND",
  "WASTEWATER TREATMENT": "WASTEWATER"
};

// ========================================
// ASSET NAME NORMALIZATION
// Handles GeoJSON naming variants (e.g. 2025 uses "TPL PARK", 2050 uses "PARK")
// ========================================
const assetNormalize = {
  "TPL PARK": "PARK",
  "SOLIDHAZARDWASTE": "SOLIDHAZARD"
};

// Helper: convert hex color to rgba string
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function normalizeCityName(value) {
  // FIXED: Only strip a trailing "CITY" (with optional preceding space), not every
  // occurrence. This prevents "ATLANTIC CITY" from becoming "ATLANTIC" and
  // "JERSEY CITY" from becoming "JERSEY", which caused false matches.
  return (value || '')
    .toUpperCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+CITY$/i, '');
}

// Expanded color match pairs for Mapbox expressions (includes normalized + alias names)
const colorMatchPairs = [];
Object.entries(colors).forEach(([key, color]) => {
  colorMatchPairs.push(key, color);
});
Object.entries(assetNormalize).forEach(([alias, normalized]) => {
  colorMatchPairs.push(alias, colors[normalized]);
});

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

// Overall summary from CSV: { "NEWARK CITY": { total, risk2025, risk2050, pct2025, pct2050, finding }, ... }
const municipalityOverall = {};

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

        // Skip header rows
        if (cols[0] === 'Public Asset' || !currentMun) continue;

        // Capture the "Overall" summary row for this municipality
        if (cols[0] === 'Overall' || (cols[0] === '' && cols[1] && parseInt(cols[1]) > 0)) {
          const totalCount = parseInt(cols[1]) || 0;
          const risk2025 = parseInt(cols[2]) || 0;
          let pct2025 = cols[3] || '0%';
          const risk2050 = parseInt(cols[4]) || 0;
          let pct2050 = cols[5] || '0%';
          const finding = cols[6] || '';

          // Normalize percentages: convert raw decimals (e.g. "0.392") to "39.2%"
          if (pct2025 && !pct2025.includes('%')) {
            const val = parseFloat(pct2025);
            if (!isNaN(val) && val >= 0 && val <= 1) {
              pct2025 = (val * 100).toFixed(1) + '%';
            }
          }
          if (pct2050 && !pct2050.includes('%')) {
            const val = parseFloat(pct2050);
            if (!isNaN(val) && val >= 0 && val <= 1) {
              pct2050 = (val * 100).toFixed(1) + '%';
            }
          }

          municipalityOverall[currentMun] = {
            total: totalCount,
            risk2025: risk2025,
            risk2050: risk2050,
            pct2025: pct2025,
            pct2050: pct2050,
            finding: finding
          };
          continue;
        }

        // Parse asset row: Asset Name, Total Count, 2025 Risk, % 2025, 2050 Risk, % 2050, Findings
        const csvAssetName = cols[0];
        const totalCount = parseInt(cols[1]) || 0;
        const appKey = csvAssetKeyMap[csvAssetName];

        if (appKey && totalCount > 0) {
          municipalityTotals[currentMun][appKey] = totalCount;
        }
      }
      console.log('Municipality totals loaded:', municipalityTotals);
      console.log('Municipality overall loaded:', municipalityOverall);
    })
    .catch(err => console.warn('Could not load municipality totals CSV:', err));
}

// ========================================
// LAYER VISIBILITY CONTROL
// Toggle between 2025 and 2050 scenarios
// ========================================
function loadLayers() {
  // Guard: if no city is active (e.g. user searched outside the 8 cities), hide everything
  if (!activeCity) {
    ['assets_2025', 'assets_2050', 'floodplain_2025', 'floodplain_2050', 'boundary'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    });
    return;
  }

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

  // Keep the active asset layer available while filters handle which public assets are hidden.
  map.setLayoutProperty(visibleAssetId, 'visibility', 'visible');

  // Filter to active municipality (respecting hidden asset types)
  map.setFilter('boundary', ['==', ['get', 'MUN'], activeCity]);

  // Build asset filter including hidden types (+ aliases)
  const assetFilters = ['all', ['==', ['get', 'MUN'], activeCity]];
  hiddenAssetTypes.forEach(type => {
    assetFilters.push(['!=', ['get', 'ASSET'], type]);
    Object.entries(assetNormalize).forEach(([alias, normalized]) => {
      if (normalized === type) assetFilters.push(['!=', ['get', 'ASSET'], alias]);
    });
  });
  map.setFilter(visibleAssetId, assetFilters);

  // Update legend after map finishes rendering
  map.once('idle', () => updateLegend());
}

function syncActiveAssetLayerVisibility() {
  ['assets_2025', 'assets_2050'].forEach(id => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', 'none');
    }
  });

  if (!activeCity) return;

  const visibleAssetId = `assets_${activeYear}`;
  if (map.getLayer(visibleAssetId)) {
    map.setLayoutProperty(visibleAssetId, 'visibility', 'visible');
  }
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
    const rawType = f.properties.ASSET;
    const type = assetNormalize[rawType] || rawType;
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
  if (!activeCity) { legend.innerHTML = ''; return; }

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

    // Restore the normal asset visibility state after querying both layers.
    syncActiveAssetLayerVisibility();

    // Get totals for the active municipality from CSV data
    const munTotals = municipalityTotals[activeCity] || {};

    // All unique asset types across both years AND totals
    const allTypes = new Set([
      ...Object.keys(counts2025),
      ...Object.keys(counts2050),
      ...Object.keys(munTotals)
    ]);

    const cityDisplayName = municipalityLabels[activeCity] || activeCity;

    // Use CSV overall totals if available, else compute from asset type totals
    const csvOverall = municipalityOverall[activeCity];
    let overallTotal, overallRisk2025, overallRisk2050, pctRisk2025, pctRisk2050;

    if (csvOverall) {
      overallTotal = csvOverall.total;
      overallRisk2025 = csvOverall.risk2025;
      overallRisk2050 = csvOverall.risk2050;
      pctRisk2025 = csvOverall.pct2025;
      pctRisk2050 = csvOverall.pct2050;
    } else {
      overallTotal = 0;
      allTypes.forEach(type => { overallTotal += (munTotals[type] || 0); });
      overallRisk2025 = total2025;
      overallRisk2050 = total2050;
      pctRisk2025 = overallTotal > 0 ? ((total2025 / overallTotal) * 100).toFixed(1) + '%' : '0%';
      pctRisk2050 = overallTotal > 0 ? ((total2050 / overallTotal) * 100).toFixed(1) + '%' : '0%';
    }

    // Update on-map findings overlay + mobile finding
    updateMapFindings(overallTotal, overallRisk2025, overallRisk2050, pctRisk2025, pctRisk2050);
    if (typeof updateMobileFinding === 'function') updateMobileFinding();

    // Build legend (cards only — findings are on the map)
    const _allOn = typeof window._allAssetsVisible === 'function' ? window._allAssetsVisible() : true;
    legend.innerHTML = `
      <h3>Step 3: Explore Exposed Assets</h3>
      <div class="toggle-all-wrap">
        <button id="toggle-all-assets" class="toggle-all-btn${_allOn ? ' active' : ''}">${_allOn ? 'Hide all public assets' : 'Show all public assets'}</button>
      </div>
      <p class="card-toggle-hint">Click a public asset card to show/hide</p>
      <div class="card-scroll-wrapper">
        <div class="card-container"></div>
        <div class="card-scroll-fade"></div>
      </div>
      <div class="scroll-hint-badge hidden">
        <span class="hint-arrow">\u2193</span>
        <span class="hint-text"></span>
      </div>
    `;

    // Re-attach toggle-all click listener (since innerHTML replaced the button)
    const _toggleAllBtn = document.getElementById('toggle-all-assets');
    if (_toggleAllBtn && typeof window._toggleAllAssets === 'function') {
      _toggleAllBtn.addEventListener('click', window._toggleAllAssets);
    }

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
      card.style.background = `linear-gradient(135deg, ${hexToRgba(color, 0.1)} 0%, ${hexToRgba(color, 0.03)} 100%)`;
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

    // --- Scroll hint: fade gradient + "X more assets" badge ---
    const scrollWrapper = legend.querySelector('.card-scroll-wrapper');
    const fadeMask = legend.querySelector('.card-scroll-fade');
    const hintBadge = legend.querySelector('.scroll-hint-badge');
    const hintText = legend.querySelector('.hint-text');

    function updateScrollHint() {
      if (!scrollWrapper || !hintBadge) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollWrapper;
      const isScrollable = scrollHeight > clientHeight + 4;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 8;

      if (!isScrollable || isAtBottom) {
        // Fully scrolled or not scrollable — hide hints
        if (fadeMask) fadeMask.classList.add('hidden');
        hintBadge.classList.add('hidden');
      } else {
        // Cards are clipped — count how many are below the fold
        if (fadeMask) fadeMask.classList.remove('hidden');
        const cards = container.querySelectorAll('.asset-card');
        const wrapperBottom = scrollWrapper.getBoundingClientRect().bottom;
        let belowCount = 0;
        cards.forEach(c => {
          if (c.getBoundingClientRect().top >= wrapperBottom - 10) belowCount++;
        });
        if (belowCount > 0 && hintText) {
          hintText.textContent = belowCount + ' more asset' + (belowCount !== 1 ? 's' : '') + ' below';
          hintBadge.classList.remove('hidden');
        } else {
          hintBadge.classList.add('hidden');
        }
      }
    }

    // Scroll the wrapper on badge click
    if (hintBadge && scrollWrapper) {
      hintBadge.addEventListener('click', () => {
        scrollWrapper.scrollBy({ top: 140, behavior: 'smooth' });
      });
    }

    // Listen for scroll events
    if (scrollWrapper) {
      scrollWrapper.addEventListener('scroll', updateScrollHint);
    }

    // Initial check after DOM settles
    requestAnimationFrame(() => {
      requestAnimationFrame(updateScrollHint);
    });

    // ---- Update mobile asset list in parallel ----
    if (typeof updateMobileAssetList === 'function') {
      updateMobileAssetList(counts2025, counts2050, munTotals, allTypes);
    }
  });
}

// ========================================
// APPLY ASSET FILTER
// Updates map filter to hide/show asset types
// ========================================
function applyAssetFilter() {
  if (!activeCity) return;
  const assetId = `assets_${activeYear}`;
  if (!map.getLayer(assetId)) return;

  const filters = ['all', ['==', ['get', 'MUN'], activeCity]];

  if (hiddenAssetTypes.size > 0) {
    // Exclude hidden types (including any GeoJSON alias names)
    hiddenAssetTypes.forEach(type => {
      filters.push(['!=', ['get', 'ASSET'], type]);
      // Also exclude aliases that normalize to this type
      Object.entries(assetNormalize).forEach(([alias, normalized]) => {
        if (normalized === type) filters.push(['!=', ['get', 'ASSET'], alias]);
      });
    });
  }

  map.setFilter(assetId, filters);
  syncActiveAssetLayerVisibility();
  if (typeof window._syncAssetToggleUi === 'function') window._syncAssetToggleUi();
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

function isPointInRing(point, ring) {
  // Standard ray-casting algorithm for point-in-polygon.
  // NOTE: The previous isPointOnSegment check was removed because it had a
  // critical bug: degenerate zero-length segments (where start === end) caused
  // it to return true for ANY point, making every coordinate in the world
  // match as "inside" any polygon containing such a segment.
  let inside = false;
  const [px, py] = point;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];

    // Skip degenerate (zero-length) segments
    if (xi === xj && yi === yj) continue;

    if (((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

function isPointInPolygon(point, rings) {
  if (!rings?.length || !isPointInRing(point, rings[0])) return false;

  for (let i = 1; i < rings.length; i++) {
    if (isPointInRing(point, rings[i])) return false;
  }

  return true;
}

function findAnalyzedCityAtLngLat(coords) {
  for (const city of _validCities) {
    const feature = boundaryFeaturesByMun[city];
    const geometry = feature?.geometry;
    if (!geometry) continue;

    if (geometry.type === 'Polygon' && isPointInPolygon(coords, geometry.coordinates)) {
      return city;
    }

    if (geometry.type === 'MultiPolygon') {
      const isInside = geometry.coordinates.some(polygon => isPointInPolygon(coords, polygon));
      if (isInside) return city;
    }
  }

  return null;
}

function findAnalyzedCityFromGeocoderResult(result) {
  // FIXED: Only check the result's primary text and the "place"-type context items.
  // Previously this also checked place_name (e.g. "Hoboken, New Jersey, United States")
  // which contains "JERSEY" as a substring, causing any NJ address to falsely match
  // to Jersey City. Now we only look at individual city/place-level text fields
  // and require an EXACT match after normalization — no substring matching.
  const candidates = [];

  // The result's own text (usually the searched place name itself, e.g. "Hoboken")
  if (result?.text) candidates.push(result.text);

  // Only check context items that represent a "place" (city-level), not state/country/region
  if (result?.context) {
    for (const item of result.context) {
      if (item?.id?.startsWith('place')) {
        if (item.text) candidates.push(item.text);
      }
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeCityName(candidate);

    for (const [normalizedName, cityKey] of Object.entries(normalizedCityKeyLookup)) {
      // FIXED: Exact match only — no substring/startsWith matching.
      // This prevents "NEW JERSEY" from matching "JERSEY" (Jersey City),
      // or "NEWARK AVENUE" from matching "NEWARK" (Newark).
      if (normalizedCandidate === normalizedName) {
        return cityKey;
      }
    }
  }

  return null;
}

function findAnalyzedCityFromText(value) {
  const normalizedValue = normalizeCityName(value);
  if (!normalizedValue) return null;

  // FIXED: After the user selects a geocoder suggestion, the input field contains
  // the full resolved text like "Hoboken, New Jersey, United States".
  // Substring matching on this would find "JERSEY" inside "NEW JERSEY" and
  // falsely match to Jersey City. So we only do an exact match on the full text,
  // OR match the first segment before a comma (the actual place name the user typed).
  const firstSegment = normalizeCityName(value.split(',')[0]);

  for (const [normalizedName, cityKey] of Object.entries(normalizedCityKeyLookup)) {
    if (normalizedValue === normalizedName || firstSegment === normalizedName) {
      return cityKey;
    }
  }

  return null;
}

function setActiveCitySelection(cityKey) {
  if (!cityKey || !_validCities.includes(cityKey)) return;

  activeCity = cityKey;

  const desktopSelect = document.getElementById('municipality-select');
  const mobileSelect = document.getElementById('mobile-municipality-select');
  if (desktopSelect) desktopSelect.value = activeCity;
  if (mobileSelect) mobileSelect.value = activeCity;

  // FIXED: Clean up any lingering geocoder popup when switching cities
  // (e.g. user searched a non-analyzed address, then picks a city from dropdown)
  const existingPopup = document.querySelector('.mapboxgl-popup');
  if (existingPopup) {
    // Only remove if it's our "city data not available" popup, not the asset hover popup
    const popupText = existingPopup.textContent || '';
    if (popupText.includes('City data not available')) {
      existingPopup.remove();
    }
  }
  const findingCard = document.getElementById('finding-card');
  if (findingCard) findingCard.style.display = '';

  loadLayers();
  zoomToMunicipality(activeCity);
  updateMunicipalityLabel();

  if (blueAcresVisible) {
    updateBlueAcresHighlight();
    updateBlueAcresStats();
  }

  if (typeof updateMobileFinding === 'function') updateMobileFinding();
  if (typeof updateMobileBlueAcresStats === 'function') updateMobileBlueAcresStats();
}

// Deactivate city selection — used when a geocoder search lands outside the 8 analyzed cities.
// Clears the dropdown, hides all city-specific layers, and hides the finding card.
function deactivateCity() {
  activeCity = null;

  // Reset both dropdowns to the blank placeholder
  const desktopSelect = document.getElementById('municipality-select');
  const mobileSelect = document.getElementById('mobile-municipality-select');
  if (desktopSelect) desktopSelect.value = '';
  if (mobileSelect) mobileSelect.value = '';

  // Hide all city-specific map layers
  ['boundary', 'floodplain_2025', 'floodplain_2050', 'assets_2025', 'assets_2050'].forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  });

  // Hide Blue Acres layers too if visible
  if (blueAcresVisible) {
    ['blueacres-fill', 'blueacres-outline', 'blueacres-clusters', 'blueacres-cluster-count'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    });
  }

  // Hide the finding card and clear legend
  const findingCard = document.getElementById('finding-card');
  if (findingCard) findingCard.style.display = 'none';
  updateFactSheetButtons();

  const legend = document.getElementById('legend');
  if (legend) legend.innerHTML = '';

  const mobileLegend = document.getElementById('mobile-asset-list');
  if (mobileLegend) mobileLegend.innerHTML = '';

  if (typeof updateMobileFinding === 'function') updateMobileFinding();
}

function getLocalCityGeocoderResults(query) {
  const normalizedQuery = normalizeCityName(query);
  if (!normalizedQuery) return [];

  return _validCities
    .map(cityKey => {
      const label = municipalityLabels[cityKey];
      const normalizedLabel = normalizeCityName(label);
      const bounds = boundaryBoundsByMun[cityKey];
      if (!label || !bounds) return null;

      if (
        normalizedLabel === normalizedQuery ||
        normalizedLabel.startsWith(normalizedQuery) ||
        normalizedQuery.startsWith(normalizedLabel)
      ) {
        const center = bounds.getCenter();
        return {
          type: 'Feature',
          center: [center.lng, center.lat],
          geometry: {
            type: 'Point',
            coordinates: [center.lng, center.lat]
          },
          place_name: `${label}, New Jersey`,
          place_type: ['place'],
          properties: {
            short_code: 'us-nj',
            analyzed_city_key: cityKey
          },
          text: label
        };
      }

      return null;
    })
    .filter(Boolean);
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
  updateFactSheetButtons();

  // Re-show the finding card when switching cities (in case user closed it)
  const card = document.getElementById('finding-card');
  if (card) card.style.display = '';
}

function updateFactSheetButtons() {
  const cityDisplayName = municipalityLabels[activeCity] || '';
  const href = municipalityFactSheetUrls[activeCity];
  const label = cityDisplayName
    ? `DOWNLOAD ${cityDisplayName.toUpperCase()} FACT SHEET`
    : 'DOWNLOAD FACT SHEET';

  ['finding-fact-sheet-btn', 'mobile-finding-fact-sheet-btn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;

    btn.textContent = label;
    btn.classList.remove('is-loading');

    if (href) {
      btn.href = href;
      btn.style.display = '';
      btn.setAttribute('aria-label', label);
    } else {
      btn.removeAttribute('href');
      btn.style.display = 'none';
      btn.removeAttribute('aria-label');
    }
  });

  setFactSheetStatus('', { persist: false });
}

function setFactSheetStatus(message, options = {}) {
  const { persist = true } = options;
  ['finding-fact-sheet-status', 'mobile-finding-fact-sheet-status'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    if (factSheetStatusTimeouts[id]) {
      clearTimeout(factSheetStatusTimeouts[id]);
      delete factSheetStatusTimeouts[id];
    }

    el.textContent = message;
    el.classList.toggle('visible', Boolean(message));

    if (message && !persist) {
      factSheetStatusTimeouts[id] = window.setTimeout(() => {
        el.textContent = '';
        el.classList.remove('visible');
        delete factSheetStatusTimeouts[id];
      }, 3200);
    }
  });
}

function attachFactSheetButtonHandlers() {
  ['finding-fact-sheet-btn', 'mobile-finding-fact-sheet-btn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn || btn.dataset.factSheetBound === 'true') return;

    btn.dataset.factSheetBound = 'true';
    btn.addEventListener('click', (event) => {
      const href = municipalityFactSheetUrls[activeCity] || btn.getAttribute('href');
      if (!href) {
        event.preventDefault();
        return;
      }
      event.preventDefault();

      document.querySelectorAll('.finding-fact-sheet-btn').forEach((node) => {
        node.classList.add('is-loading');
      });
      setFactSheetStatus('Opening PDF in a new tab. Stay on this map while the fact sheet loads.');

      const opened = window.open(href, '_blank', 'noopener');
      if (!opened) {
        setFactSheetStatus('Please allow pop-ups for the fact sheet download, then try again.', { persist: false });
      }

      window.setTimeout(() => {
        document.querySelectorAll('.finding-fact-sheet-btn').forEach((node) => {
          node.classList.remove('is-loading');
        });
        setFactSheetStatus('If the PDF is taking a moment, keep this map open while it finishes loading.', { persist: false });
      }, 2200);
    });
  });
}

function updateMapFindings(overallTotal, total2025, total2050, pctRisk2025, pctRisk2050) {
  const el = document.getElementById('finding-text');
  if (!el) return;

  // Use CSV findings if available for this city
  const csvOverall = municipalityOverall[activeCity];
  if (csvOverall && csvOverall.finding) {
    el.innerHTML = csvOverall.finding;
    return;
  }

  // Fallback: generate sentence if CSV finding is missing
  if (overallTotal === 0) {
    el.innerHTML = '';
    return;
  }

  const cityDisplayName = municipalityLabels[activeCity] || activeCity;

  el.innerHTML = `
    Of <strong>${overallTotal}</strong> public assets in ${cityDisplayName},
    <strong>${total2025}</strong> are in the floodplain today &mdash;
    <span class="finding-2050">rising to ${total2050} by 2050</span>
    (${pctRisk2050} of all assets).
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
  attachFactSheetButtonHandlers();
  
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
        if (_validCities.includes(mun)) boundaryFeaturesByMun[mun] = f;
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
          ...colorMatchPairs,
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
    setActiveCitySelection(e.target.value);
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

    // Show/hide Blue Acres layers
    ['blueacres-fill', 'blueacres-outline', 'blueacres-clusters', 'blueacres-cluster-count'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });

    // Keep public assets visible according to the user's active type filters.
    syncActiveAssetLayerVisibility();

    if (blueAcresVisible) {
      updateBlueAcresHighlight();
    }
    updateBlueAcresStats();
  };

  // ---- Geocoder (address search) ----
  // FIXED: Declare geocoderContainer BEFORE geocoder so it's available in event handlers
  const geocoderContainer = document.getElementById('geocoder-container');

  const geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    mapboxgl: mapboxgl,
    localGeocoder: getLocalCityGeocoderResults,
    marker: {
      color: '#f7c320'
    },
    countries: 'us',
    bbox: [-75.559614, 38.928519, -73.893979, 41.357423],
    placeholder: 'Enter Address Here',
    flyTo: false
  });

  let geocoderPopup = null;

  geocoder.on('result', (e) => {
    console.log('[Geocoder] result event fired', e.result);
    const coords = e.result.center;
    const findingCard = document.getElementById('finding-card');

    // Clean up any previous popup
    if (geocoderPopup) { geocoderPopup.remove(); geocoderPopup = null; }

    // ---- Determine matched city using 3 strategies ----
    let matchedCity = null;

    // Strategy 1: Direct city key from our local geocoder suggestions
    const directCityKey = e.result?.properties?.analyzed_city_key;
    if (directCityKey && _validCities.includes(directCityKey)) {
      matchedCity = directCityKey;
      console.log('[Geocoder] Matched via local city key:', matchedCity);
    }

    // Strategy 2: Point-in-polygon — do the coordinates land inside one of our 8 cities?
    if (!matchedCity) {
      matchedCity = findAnalyzedCityAtLngLat(coords);
      if (matchedCity) console.log('[Geocoder] Matched via point-in-polygon:', matchedCity);
    }

    // Strategy 3: Check geocoder result metadata — only the "place" context field
    if (!matchedCity) {
      matchedCity = findAnalyzedCityFromGeocoderResult(e.result);
      if (matchedCity) console.log('[Geocoder] Matched via geocoder result metadata:', matchedCity);
    }

    console.log('[Geocoder] Final matchedCity:', matchedCity);

    // ---- Act on the result ----
    if (matchedCity) {
      // Hide the geocoder marker (we're zooming to the full city instead)
      const markerEl = geocoderContainer?.querySelector('.mapboxgl-marker');
      if (markerEl) markerEl.style.display = 'none';

      setActiveCitySelection(matchedCity);
      if (findingCard) findingCard.style.display = '';
    } else {
      // NOT one of our 8 cities — deactivate everything and show the popup
      console.log('[Geocoder] No match — deactivating city, showing popup');
      deactivateCity();

      // Zoom to the searched location
      map.flyTo({
        center: coords,
        zoom: 13,
        padding: { top: 0, bottom: 0, left: 0, right: window.innerWidth > 1024 ? 410 : 0 },
        speed: 1.2,
        curve: 1
      });

      // Ensure the yellow marker is visible at the searched address
      const markerEl = geocoderContainer?.querySelector('.mapboxgl-marker');
      if (markerEl) markerEl.style.display = '';

      geocoderPopup = new mapboxgl.Popup({
        closeButton: true,
        maxWidth: '300px',
        anchor: 'bottom',
        offset: [0, -10]
      })
      .setLngLat(coords)
      .setHTML(`
        <div style="padding:6px 4px;font-size:13px;line-height:1.6">
          <strong>City data not available</strong><br/>
          This location is not within one of the 8 cities currently mapped.
          Please request your city by contacting
          <a href="mailto:info@rebuildbydesign.org" style="color:#3a7fc3">info@rebuildbydesign.org</a>
        </div>
      `)
      .addTo(map);

      geocoderPopup.on('close', () => {
        geocoderPopup = null;
      });
    }
  });

  geocoder.on('clear', () => {
    if (geocoderPopup) { geocoderPopup.remove(); geocoderPopup = null; }
    // Restore marker visibility for next search
    const markerEl = geocoderContainer?.querySelector('.mapboxgl-marker');
    if (markerEl) markerEl.style.display = '';

    // If city was deactivated (non-analyzed search), restore default city
    if (!activeCity) {
      setActiveCitySelection('NEWARK CITY');
    } else {
      const findingCard = document.getElementById('finding-card');
      if (findingCard) findingCard.style.display = '';
    }
  });

  // Mount geocoder into sidebar container
  if (geocoderContainer) {
    geocoderContainer.appendChild(geocoder.onAdd(map));
  }

  // ---- Toggle All Assets button ----
  function areAllAssetsHidden() {
    return allAssetTypes.every(type => hiddenAssetTypes.has(type));
  }

  function syncAssetToggleUi() {
    const hasVisibleTypes = !areAllAssetsHidden();

    // Update button state (desktop + mobile)
    const desktopBtn = document.getElementById('toggle-all-assets');
    const mobileBtn = document.getElementById('mobile-toggle-all-assets');
    if (desktopBtn) {
      desktopBtn.classList.toggle('active', hasVisibleTypes);
      desktopBtn.textContent = hasVisibleTypes ? 'Hide all public assets' : 'Show all public assets';
    }
    if (mobileBtn) {
      mobileBtn.classList.toggle('active', hasVisibleTypes);
      const mobileDesc = mobileBtn.querySelector('.chip-desc');
      if (mobileDesc) mobileDesc.textContent = hasVisibleTypes ? 'Hide all types' : 'Show all types';
    }

    document.querySelectorAll('#legend .asset-card').forEach(card => {
      const type = card.dataset.assetType;
      const isHidden = hiddenAssetTypes.has(type);
      card.classList.toggle('asset-card-off', isHidden);
      card.title = `Click to ${isHidden ? 'show' : 'hide'} ${(assetLabels[type] || type)} on map`;
    });
    document.querySelectorAll('#mobile-asset-list .asset-card').forEach(card => {
      const type = card.dataset.assetType;
      const isHidden = hiddenAssetTypes.has(type);
      card.classList.toggle('asset-card-off', isHidden);
      card.title = `Click to ${isHidden ? 'show' : 'hide'} ${(assetLabels[type] || type)} on map`;
    });
  }

  function setAllAssetsVisibility(visible) {
    if (visible) {
      hiddenAssetTypes.clear();
    } else {
      allAssetTypes.forEach(type => hiddenAssetTypes.add(type));
    }
    applyAssetFilter();
  }

  // Expose toggle handler globally so updateLegend can re-attach it
  window._toggleAllAssets = () => setAllAssetsVisibility(areAllAssetsHidden());
  window._syncAssetToggleUi = syncAssetToggleUi;

  document.getElementById('toggle-all-assets')?.addEventListener('click', window._toggleAllAssets);
  document.getElementById('mobile-toggle-all-assets')?.addEventListener('click', window._toggleAllAssets);

  // Expose for loadLayers to respect
  window._allAssetsVisible = () => !areAllAssetsHidden();
  syncAssetToggleUi();

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
        const normalizedAsset = assetNormalize[props.ASSET] || props.ASSET;
        const assetType = assetLabels[normalizedAsset] || normalizedAsset || 'Unknown';
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


// ========================================
// MOBILE BOTTOM SHEET — Tab switching, chip toggles, syncing
// ========================================
(function initMobileSheet() {
  const isMobile = () => window.innerWidth <= 768;

  // ---- Collapse / Expand toggle ----
  const sheet = document.getElementById('mobile-sheet');
  const sheetToggle = document.getElementById('mobile-sheet-toggle');
  const toggleLabel = sheetToggle ? sheetToggle.querySelector('.mobile-toggle-label') : null;

  if (sheetToggle && sheet) {
    sheetToggle.addEventListener('click', () => {
      if (sheet.classList.contains('collapsed')) {
        sheet.classList.remove('collapsed');
        sheet.classList.add('expanded');
        if (toggleLabel) toggleLabel.textContent = 'Click to Hide Map Controls';
      } else {
        sheet.classList.remove('expanded');
        sheet.classList.add('collapsed');
        if (toggleLabel) toggleLabel.textContent = 'Click to Explore Map Controls';
      }
    });
  }

  // ---- Tab switching ----
  const tabs = document.querySelectorAll('.mobile-sheet-tabs .mobile-tab');
  const tabLayers = document.getElementById('mobile-tab-layers');
  const tabAssets = document.getElementById('mobile-tab-assets');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const which = tab.dataset.tab;
      if (which === 'layers') {
        tabLayers.classList.remove('hidden');
        tabAssets.classList.add('hidden');
      } else {
        tabAssets.classList.remove('hidden');
        tabLayers.classList.add('hidden');
      }
    });
  });

  // ---- Mobile city dropdown — sync with desktop ----
  const mobileSelect = document.getElementById('mobile-municipality-select');
  const desktopSelect = document.getElementById('municipality-select');

  if (mobileSelect) {
    mobileSelect.addEventListener('change', e => {
      setActiveCitySelection(e.target.value);
    });
  }

  // Keep mobile select in sync when desktop select changes
  if (desktopSelect) {
    desktopSelect.addEventListener('change', () => {
      if (mobileSelect) mobileSelect.value = activeCity;
      updateMobileFinding();
      updateMobileBlueAcresStats();
    });
  }

  // ---- Chip toggles (mirror desktop button behavior) ----
  const chip2025 = document.getElementById('mobile-toggle-2025');
  const chip2050 = document.getElementById('mobile-toggle-2050');
  const chipBA = document.getElementById('mobile-toggle-blue-acres');
  const desktopBtn2025 = document.getElementById('toggle-2025');
  const desktopBtn2050 = document.getElementById('toggle-2050');
  const desktopBtnBA = document.getElementById('toggle-blue-acres');

  if (chip2025) {
    chip2025.addEventListener('click', () => {
      show2025 = !show2025;
      chip2025.classList.toggle('active', show2025);
      if (desktopBtn2025) desktopBtn2025.classList.toggle('active', show2025);
      loadLayers();
    });
  }

  if (chip2050) {
    chip2050.addEventListener('click', () => {
      show2050 = !show2050;
      chip2050.classList.toggle('active', show2050);
      if (desktopBtn2050) desktopBtn2050.classList.toggle('active', show2050);
      loadLayers();
    });
  }

  if (chipBA) {
    chipBA.addEventListener('click', () => {
      // Trigger the desktop Blue Acres button click (it has all the logic)
      if (desktopBtnBA) desktopBtnBA.click();
      chipBA.classList.toggle('active', blueAcresVisible);
      updateMobileBlueAcresStats();
    });
  }

  // ---- Mobile finding text ----
  window.updateMobileFinding = function() {
    const el = document.getElementById('mobile-finding-text');
    if (!el) return;

    const csvOverall = municipalityOverall[activeCity];
    if (csvOverall && csvOverall.finding) {
      el.innerHTML = csvOverall.finding;
      return;
    }

    // Fallback: use computed counts
    const cityDisplayName = municipalityLabels[activeCity] || activeCity;
    const overall = municipalityOverall[activeCity];
    if (overall) {
      el.innerHTML = `
        Of <strong>${overall.total}</strong> public assets in ${cityDisplayName},
        <strong>${overall.risk2025}</strong> are in the floodplain today &mdash;
        <span class="finding-2050">rising to ${overall.risk2050} by 2050</span>
        (${overall.pct2050} of all assets).
      `;
    } else {
      el.innerHTML = `Select a city to see flood exposure findings.`;
    }
  };

  // ---- Mobile Blue Acres stats ----
  window.updateMobileBlueAcresStats = function() {
    const statsEl = document.getElementById('mobile-blue-acres-stats');
    if (!statsEl) return;

    if (!blueAcresVisible) {
      statsEl.classList.add('hidden');
      return;
    }

    statsEl.classList.remove('hidden');

    const total = blueAcresTotalCount;
    const matchingBaMun = Object.entries(blueAcresMunMap)
      .find(([_, appKey]) => appKey === activeCity);
    const baMunName = matchingBaMun ? matchingBaMun[0] : null;
    const cityCount = baMunName ? (blueAcresCounts[baMunName] || 0) : 0;
    const cityDisplayName = municipalityLabels[activeCity] || activeCity;

    if (cityCount > 0) {
      statsEl.innerHTML = `
        <span class="stat-highlight">${total.toLocaleString()}</span> parcels acquired statewide.
        <span class="stat-city">${cityDisplayName}</span> has
        <span class="stat-highlight">${cityCount}</span> Blue Acres parcel${cityCount !== 1 ? 's' : ''}.
      `;
    } else {
      statsEl.innerHTML = `
        <span class="stat-highlight">${total.toLocaleString()}</span> parcels acquired statewide.
        <span class="stat-city">${cityDisplayName}</span> has no Blue Acres parcels yet.
      `;
    }
  };

  // ---- Mobile asset list (mirrors updateLegend cards) ----
  window.updateMobileAssetList = function(counts2025, counts2050, munTotals, allTypes) {
    const container = document.getElementById('mobile-asset-list');
    if (!container) return;

    container.innerHTML = '';

    // Sort by 2050 exposure percentage descending
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

      const pct2025 = (c2025 / total) * 100;
      const pct2050 = (c2050 / total) * 100;

      const card = document.createElement('div');
      card.className = 'asset-card' + (isVisible ? '' : ' asset-card-off');
      card.dataset.assetType = type;
      card.style.borderLeftColor = color;
      card.style.background = `linear-gradient(135deg, ${hexToRgba(color, 0.1)} 0%, ${hexToRgba(color, 0.03)} 100%)`;
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

      // Click to toggle
      card.addEventListener('click', () => {
        if (hiddenAssetTypes.has(type)) {
          hiddenAssetTypes.delete(type);
          card.classList.remove('asset-card-off');
        } else {
          hiddenAssetTypes.add(type);
          card.classList.add('asset-card-off');
        }
        applyAssetFilter();
        // Also sync desktop legend cards
        document.querySelectorAll(`#legend .asset-card[data-asset-type="${type}"]`).forEach(c => {
          c.classList.toggle('asset-card-off', hiddenAssetTypes.has(type));
        });
      });
    });
  };

  // ---- Mobile CSV download ----
  const mobileDL = document.getElementById('mobile-download-csv');
  const desktopDL = document.getElementById('download-csv');
  if (mobileDL && desktopDL) {
    mobileDL.addEventListener('click', () => desktopDL.click());
  }
})();
