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

// --- Deep-link: read ?city= and ?county= URL parameters from county map ---
const _urlCityParam = new URLSearchParams(window.location.search).get('city');
const _urlCountyParam = new URLSearchParams(window.location.search).get('county');
// _validCities holds every UNIQUE NJ municipality NAME from boundary.json.
// ALL_MUNICIPALITIES is defined in data/municipalities.js (loaded before this file).
const _validCities = (typeof ALL_MUNICIPALITIES !== 'undefined' && Array.isArray(ALL_MUNICIPALITIES))
    ? ALL_MUNICIPALITIES.slice()
    : ["NEWARK CITY","ELIZABETH CITY","CAMDEN CITY","TRENTON CITY",
       "JERSEY CITY","PATERSON CITY","ASBURY PARK CITY","ATLANTIC CITY"];

// ========================================
// COMPOSITE MUNICIPALITY KEY (MUN + COUNTY)
// 12 township names repeat across counties (5 Washington Twps, 4 Franklin, etc.).
// We must identify each municipality by NAME + COUNTY, not name alone, or the
// same-named townships collapse onto one set of numbers. _muniRecords holds one
// {mun, county} per real municipality (564 total; Pine Valley removed).
// ========================================
const _muniRecords = (typeof ALL_MUNICIPALITY_RECORDS !== 'undefined' && Array.isArray(ALL_MUNICIPALITY_RECORDS))
    ? ALL_MUNICIPALITY_RECORDS.slice()
    : _validCities.map(m => ({ mun: m, county: null }));

// How many counties each municipality NAME appears in.
const _munCountByName = {};
_muniRecords.forEach(r => { _munCountByName[r.mun] = (_munCountByName[r.mun] || 0) + 1; });
// List of counties for each name (used to resolve a county when none is supplied).
const _countiesByMun = {};
_muniRecords.forEach(r => { (_countiesByMun[r.mun] = _countiesByMun[r.mun] || []).push(r.county); });

// True when a name exists in more than one county and therefore needs the county
// to disambiguate it (Washington Twp, Franklin Twp, etc.).
function isSameNamed(mun) { return (_munCountByName[mun] || 0) > 1; }

// Canonical key. For unique names this is just the name (so border-tagged strays
// still aggregate under the one city); for same-named towns it is "MUN|COUNTY".
function cityKey(mun, county) {
  return (county && isSameNamed(mun)) ? `${mun}|${county}` : mun;
}

// Given a name and an optional county, return the county we should use. If the
// name is unique, county is irrelevant (return null). If same-named and a county
// was supplied and valid, use it; otherwise fall back to the first county.
function resolveCounty(mun, county) {
  if (!isSameNamed(mun)) return null;
  const counties = _countiesByMun[mun] || [];
  if (county && counties.includes(county)) return county;
  return counties[0] || null;
}

// The 8 cities that have full per-city findings data (CSV + fact sheets)
const _analyzedCities = ["NEWARK CITY","ELIZABETH CITY","CAMDEN CITY","TRENTON CITY",
                         "JERSEY CITY","PATERSON CITY","ASBURY PARK CITY","ATLANTIC CITY"];

let activeCity = (_urlCityParam && _validCities.includes(_urlCityParam))
    ? _urlCityParam
    : "NEWARK CITY";
// County paired with activeCity (only meaningful for same-named towns).
let activeCounty = resolveCounty(activeCity, _urlCountyParam ? _urlCountyParam.toUpperCase() : null);

// Composite key for the active municipality (used for all data lookups).
function activeKey() { return cityKey(activeCity, activeCounty); }

// Mapbox filter expression scoping a layer to the active municipality. For
// same-named towns it adds the COUNTY condition so only the right polygon /
// assets / floodplain show; for unique names it filters by name alone.
function munFilter() {
  if (activeCounty && isSameNamed(activeCity)) {
    return ['all', ['==', ['get', 'MUN'], activeCity], ['==', ['get', 'COUNTY'], activeCounty]];
  }
  return ['==', ['get', 'MUN'], activeCity];
}

// Title-case a county name for display ("GLOUCESTER" -> "Gloucester").
function formatCountyLabel(county) {
  if (!county) return '';
  return county.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// Initial input value sync happens later, after formatMunLabel() is defined
// (see populateMunicipalityDatalist call below). This keeps the input showing
// the friendly display label (e.g. "Newark") instead of the raw MUN key.

let hoverPopup = null;
let selectedAssetPopup = null;

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

function removeHoverPopup() {
  if (hoverPopup) {
    hoverPopup.remove();
    hoverPopup = null;
  }
}

function closeSelectedAssetPopup() {
  if (selectedAssetPopup) {
    selectedAssetPopup.remove();
    selectedAssetPopup = null;
  }
}

function buildAssetPopupHtml(feature) {
  const name = feature?.properties?.NAME
    ? feature.properties.NAME.toUpperCase()
    : 'PUBLIC ASSET';

  return `<strong>${name}</strong>`;
}

function openSelectedAssetPopup(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates) return;

  removeHoverPopup();
  closeSelectedAssetPopup();

  selectedAssetPopup = new mapboxgl.Popup({
    className: 'asset-selected-popup',
    closeButton: true,
    closeOnClick: false,
    offset: 12
  })
    .setLngLat(coordinates)
    .setHTML(buildAssetPopupHtml(feature))
    .addTo(map);

  selectedAssetPopup.on('close', () => {
    selectedAssetPopup = null;
  });
}

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
// Custom labels live here for the 8 cities with full analysis; every other
// MUN is formatted on the fly by formatMunLabel() below.
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

// Convert a MUN key like "HOBOKEN CITY" / "ABERDEEN TWP" / "RIDGEWOOD VILLAGE"
// into a cleaner display label like "Hoboken", "Aberdeen Twp", "Ridgewood".
// Falls back to title-case if no specific rule applies.
function formatMunLabel(mun) {
  if (!mun) return '';
  if (municipalityLabels[mun]) return municipalityLabels[mun];

  // Suffix handling: strip pure "CITY" and "VILLAGE" (they're implied by context),
  // but keep "TWP"/"TOWN"/"BORO" since many towns share names with nearby cities
  // (e.g. "CLINTON TOWN" vs "CLINTON TWP") and we don't want to conflate them.
  let label = mun;
  const stripSuffixes = [' CITY', ' VILLAGE'];
  for (const suffix of stripSuffixes) {
    if (label.endsWith(suffix)) {
      label = label.slice(0, -suffix.length);
      break;
    }
  }
  // Title-case each word; keep common muni suffixes in their abbreviated form.
  return label
    .toLowerCase()
    .split(' ')
    .map(word => {
      if (word === 'twp') return 'Twp';
      if (word === 'boro') return 'Boro';
      if (word === 'town') return 'Town';
      if (word.includes('-')) {
        return word.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

// Every NJ municipality has a fact sheet on the nj-flood-risk-fact-sheet-cities
// repo. The fact sheet site normalizes the ?city= param via slugifyCityName, so
// the display label (or the raw MUN key) resolves to the right row.
const FACT_SHEET_BASE_URL = 'https://rebuildbydesign.github.io/nj-flood-risk-fact-sheet-cities/';

// Display name including county for same-named townships:
// "Washington Township (Gloucester)"; plain label for unique names.
function cityDisplay(mun, county) {
  const base = formatMunLabel(mun) || mun || '';
  return (isSameNamed(mun) && county) ? `${base} (${formatCountyLabel(county)})` : base;
}

function getFactSheetUrl(mun, county) {
  if (!mun) return '';
  const label = formatMunLabel(mun) || mun;
  let url = `${FACT_SHEET_BASE_URL}?city=${encodeURIComponent(label)}`;
  // Same-named towns need the county so the fact sheet opens the right row.
  if (isSameNamed(mun) && county) {
    url += `&county=${encodeURIComponent(formatCountyLabel(county))}`;
  }
  return url;
}

const factSheetStatusTimeouts = {};

// Build reverse lookup for every NJ municipality so the typeahead input,
// geocoder result matching, and ?city= deep-links all resolve to a MUN key.
// Two entries per muni: the raw MUN ("NEWARK CITY") and the display label ("Newark").
const normalizedCityKeyLookup = {};
_validCities.forEach((cityKey) => {
  normalizedCityKeyLookup[normalizeCityName(cityKey)] = cityKey;
  const label = formatMunLabel(cityKey);
  if (label) normalizedCityKeyLookup[normalizeCityName(label)] = cityKey;
});

// Resolve whatever a user typed or selected from the datalist (display label,
// full MUN key, or a partial variant) back to a canonical MUN key.
function resolveMunFromInputValue(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  if (_validCities.includes(trimmed)) return trimmed;
  const upper = trimmed.toUpperCase();
  if (_validCities.includes(upper)) return upper;
  const normalized = normalizeCityName(trimmed);
  if (normalizedCityKeyLookup[normalized]) return normalizedCityKeyLookup[normalized];
  // Fallback: try first-segment match (e.g. "Newark, New Jersey" → "Newark")
  const firstSegment = normalizeCityName(trimmed.split(',')[0]);
  if (firstSegment && normalizedCityKeyLookup[firstSegment]) {
    return normalizedCityKeyLookup[firstSegment];
  }
  return null;
}

// ========================================
// CUSTOM MUNICIPALITY TYPEAHEAD
// Replaces native <datalist> (which browsers render as un-styleable light
// popups). Each input is paired with a <ul> dropdown built by index.html;
// this wires them together with filter/keyboard/select behavior and keeps
// the two instances (desktop + mobile) in sync via setActiveCitySelection.
// ========================================

// Pre-sorted list of { mun, county, key, label } used for filtering. One entry
// per real municipality, so each same-named township appears separately, e.g.
// "Washington Township (Bergen)" ... "Washington Township (Warren)".
const _muniSearchEntries = _muniRecords
  .map(({ mun, county }) => ({
    mun,
    county,
    key: cityKey(mun, county),
    label: cityDisplay(mun, county)
  }))
  .filter((e) => e.label)
  .sort((a, b) => a.label.localeCompare(b.label));

// Escape HTML so a muni name containing < or & can't break the markup.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Highlight the part of `label` that matches `query` with a <mark>. Case-insensitive.
function highlightMatch(label, query) {
  const safe = escapeHtml(label);
  if (!query) return safe;
  const q = query.trim();
  if (!q) return safe;
  const lowerLabel = label.toLowerCase();
  const lowerQ = q.toLowerCase();
  const hitStart = lowerLabel.indexOf(lowerQ);
  if (hitStart < 0) return safe;
  const before = escapeHtml(label.slice(0, hitStart));
  const hit = escapeHtml(label.slice(hitStart, hitStart + q.length));
  const after = escapeHtml(label.slice(hitStart + q.length));
  return `${before}<mark>${hit}</mark>${after}`;
}

// Return up to `limit` entries that match a free-text query. Prefix matches
// rank above substring matches so typing "new" surfaces Newark first, then
// East Newark Boro, then New Brunswick, etc.
function filterMuniEntries(query, limit = 50) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return _muniSearchEntries.slice(0, limit);

  const prefix = [];
  const contains = [];
  for (const e of _muniSearchEntries) {
    const l = e.label.toLowerCase();
    if (l.startsWith(q)) prefix.push(e);
    else if (l.includes(q)) contains.push(e);
    if (prefix.length + contains.length >= limit * 2) break;
  }
  return [...prefix, ...contains].slice(0, limit);
}

function initMuniSearch(inputEl, listEl) {
  if (!inputEl || !listEl) return;

  let activeIndex = -1;
  let currentMatches = [];

  function render(query) {
    currentMatches = filterMuniEntries(query);
    activeIndex = currentMatches.length ? 0 : -1;
    if (!currentMatches.length) {
      listEl.innerHTML = '<li class="muni-search-empty">No municipality matches</li>';
    } else {
      listEl.innerHTML = currentMatches
        .map((e, i) => {
          const active = i === activeIndex ? ' is-active' : '';
          const countyAttr = e.county ? ` data-county="${escapeHtml(e.county)}"` : '';
          return `<li class="muni-search-option${active}" role="option" data-mun="${escapeHtml(e.mun)}"${countyAttr} data-index="${i}">${highlightMatch(e.label, query)}</li>`;
        })
        .join('');
    }
    listEl.hidden = false;
  }

  function hide() {
    listEl.hidden = true;
    activeIndex = -1;
  }

  function commit(entryOrValue) {
    if (entryOrValue && typeof entryOrValue === 'object' && entryOrValue.mun) {
      // From a selected suggestion: carries mun + county.
      setActiveCitySelection({ mun: entryOrValue.mun, county: entryOrValue.county || null });
    } else {
      const mun = resolveMunFromInputValue(entryOrValue);
      if (mun) {
        setActiveCitySelection(mun);
      } else {
        // Typed text we can't match — revert to the active city's label
        inputEl.value = activeCity ? cityDisplay(activeCity, activeCounty) : '';
      }
    }
    hide();
  }

  function setActive(newIndex) {
    const options = listEl.querySelectorAll('.muni-search-option');
    if (!options.length) return;
    if (newIndex < 0) newIndex = options.length - 1;
    if (newIndex >= options.length) newIndex = 0;
    options.forEach((el, i) => el.classList.toggle('is-active', i === newIndex));
    activeIndex = newIndex;
    const active = options[newIndex];
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  inputEl.addEventListener('focus', () => render(inputEl.value));
  inputEl.addEventListener('input', () => render(inputEl.value));

  inputEl.addEventListener('keydown', (e) => {
    if (listEl.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      render(inputEl.value);
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') { setActive(activeIndex + 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActive(activeIndex - 1); e.preventDefault(); }
    else if (e.key === 'Enter') {
      if (activeIndex >= 0 && currentMatches[activeIndex]) {
        commit(currentMatches[activeIndex]);
      } else {
        commit(inputEl.value);
      }
      e.preventDefault();
    } else if (e.key === 'Escape') {
      hide();
      inputEl.blur();
    }
  });

  // Mousedown (not click) so the input's blur doesn't fire first and hide the list.
  listEl.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.muni-search-option');
    if (!li) return;
    e.preventDefault();
    const mun = li.dataset.mun;
    if (mun) commit({ mun, county: li.dataset.county || null });
  });

  inputEl.addEventListener('blur', () => {
    // Delay so a click on the list can still register.
    setTimeout(() => { hide(); }, 150);
  });

  // Native change event (e.g. programmatic change). Keep for safety.
  inputEl.addEventListener('change', () => {
    const resolved = resolveMunFromInputValue(inputEl.value);
    if (resolved && resolved !== activeCity) setActiveCitySelection(resolved);
  });
}

function setupMuniSearch() {
  initMuniSearch(
    document.getElementById('municipality-select'),
    document.getElementById('muni-search-list')
  );
  initMuniSearch(
    document.getElementById('mobile-municipality-select'),
    document.getElementById('mobile-muni-search-list')
  );

  // Seed both inputs with the active city's friendly label on startup.
  const desktopSelect = document.getElementById('municipality-select');
  const mobileSelect = document.getElementById('mobile-municipality-select');
  const currentLabel = activeCity ? cityDisplay(activeCity, activeCounty) : '';
  if (desktopSelect) desktopSelect.value = currentLabel;
  if (mobileSelect) mobileSelect.value = currentLabel;
}

setupMuniSearch();

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
  "SOLID & HAZARD": "SOLIDHAZARD",                 // legacy 8-city CSV label
  "SOLID & HAZARDOUS WASTE SITE": "SOLIDHAZARD",   // statewide gis-export label
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

// (Legacy csvMunKeyMap removed — no longer needed now that the statewide
// gis-export-key-findings.csv already uses MUN keys matching boundary.json.)

// ========================================
// MUNICIPALITY TOTALS - loaded from CSV
// Structure: { "NEWARK CITY": { "KCS": 510, "SCHOOL": 121, ... }, ... }
// ========================================
const municipalityTotals = {};

// Overall summary from CSV: { "NEWARK CITY": { total, risk2025, risk2050, pct2025, pct2050, finding }, ... }
const municipalityOverall = {};

// Quote- and multiline-aware CSV parser. Needed because gis-export-key-findings.csv
// has fields like "Luminace Solar New Jersey, LLC" and a few rows that contain
// embedded newlines inside quoted names.
function parseCsvText(text) {
  const rows = [];
  let cur = [''];
  let field = 0;
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { cur[field] += '"'; i++; }
      else { inQ = !inQ; }
    } else if (c === ',' && !inQ) {
      cur.push('');
      field++;
    } else if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (cur.length > 1 || cur[0]) rows.push(cur);
      cur = [''];
      field = 0;
    } else {
      cur[field] += c;
    }
  }
  if (cur.length > 1 || cur[0]) rows.push(cur);
  return rows;
}

// Loads the statewide GIS export (one row per public asset). Aggregates counts
// per municipality + computes overall 2025 / 2050 floodplain exposure and a
// display-ready "finding" sentence used by the key-finding card.
function loadMunicipalityTotals() {
  return fetch('data/gis-export-key-findings.csv')
    .then(res => res.text())
    .then(text => {
      const rows = parseCsvText(text);
      if (!rows.length) return;

      const header = rows[0];
      const idx = {
        asset: header.indexOf('PUBLIC_ASSET'),
        id: header.indexOf('UNIQUE_ID'),
        name: header.indexOf('NAME'),
        county: header.indexOf('COUNTY'),
        // Note: the CSV header is spelled "MUNCIPALITY" (missing the I) — keep as-is.
        mun: header.indexOf('MUNCIPALITY'),
        flood2025: header.indexOf('2025_FLOOD'),
        flood2050: header.indexOf('2050 FLOOD')
      };

      if (idx.mun < 0 || idx.asset < 0 || idx.flood2025 < 0 || idx.flood2050 < 0) {
        console.warn('gis-export-key-findings.csv header unexpected:', header);
        return;
      }

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length !== header.length) continue;

        let mun = (row[idx.mun] || '').trim();
        if (!mun) continue;
        // The assets GeoJSON uses "SOUTH ORANGE VILLAGE TWP" — the CSV omits TWP.
        // Keep the two in sync so filters and lookups match.
        if (mun === 'SOUTH ORANGE VILLAGE') mun = 'SOUTH ORANGE VILLAGE TWP';

        const county = (row[idx.county] || '').trim().toUpperCase();
        // Composite key: same-named townships are kept distinct by county; unique
        // names aggregate all rows (including any border-mis-tagged county) together.
        const key = cityKey(mun, county);

        const csvAsset = (row[idx.asset] || '').trim();
        const appKey = csvAssetKeyMap[csvAsset];
        if (!appKey) continue;

        if (!municipalityTotals[key]) municipalityTotals[key] = {};
        municipalityTotals[key][appKey] = (municipalityTotals[key][appKey] || 0) + 1;

        if (!municipalityOverall[key]) {
          municipalityOverall[key] = {
            mun, county: isSameNamed(mun) ? county : null,
            total: 0, risk2025: 0, risk2050: 0,
            pct2025: '0%', pct2050: '0%', finding: ''
          };
        }
        municipalityOverall[key].total += 1;
        if ((row[idx.flood2025] || '').trim() === '1') municipalityOverall[key].risk2025 += 1;
        if ((row[idx.flood2050] || '').trim() === '1') municipalityOverall[key].risk2050 += 1;
      }

      // Compute percentages + generate the findings sentence (same template the map
      // and mobile sheet expect). Uses cityDisplay for a friendly display name.
      Object.keys(municipalityOverall).forEach((key) => {
        const m = municipalityOverall[key];
        const p25 = m.total > 0 ? ((m.risk2025 / m.total) * 100).toFixed(1) + '%' : '0%';
        const p50 = m.total > 0 ? ((m.risk2050 / m.total) * 100).toFixed(1) + '%' : '0%';
        m.pct2025 = p25;
        m.pct2050 = p50;

        const display = cityDisplay(m.mun, m.county);
        if (m.total === 0) {
          m.finding = `No public assets are mapped for ${display}.`;
        } else if (m.risk2050 === 0) {
          m.finding = `None of the <strong>${m.total}</strong> public assets in ${display} fall inside the 2025 or 2050 floodplain.`;
        } else {
          m.finding = `Of <strong>${m.total}</strong> public assets in ${display}, <strong>${m.risk2025}</strong> are in the floodplain today &mdash; <span class="finding-2050">rising to ${m.risk2050} by 2050</span> (${p50} of all assets).`;
        }
      });

      console.log('Loaded totals for', Object.keys(municipalityOverall).length, 'municipalities');
    })
    .catch(err => console.warn('Could not load gis-export-key-findings.csv:', err));
}

// ========================================
// LAYER VISIBILITY CONTROL
// Toggle between 2025 and 2050 scenarios
// ========================================
function loadLayers() {
  // Guard: if no city is active (e.g. user searched an address outside NJ), hide everything
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
      map.setFilter(id, munFilter());
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
  map.setFilter('boundary', munFilter());

  // Build asset filter including hidden types (+ aliases)
  const assetFilters = ['all', munFilter()];
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
    filter: munFilter()
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
    const munTotals = municipalityTotals[activeKey()] || {};

    // All unique asset types across both years AND totals
    const allTypes = new Set([
      ...Object.keys(counts2025),
      ...Object.keys(counts2050),
      ...Object.keys(munTotals)
    ]);

    const cityDisplayName = cityDisplay(activeCity, activeCounty) || activeCity;

    // Use CSV overall totals if available, else compute from asset type totals
    const csvOverall = municipalityOverall[activeKey()];
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

  const filters = ['all', munFilter()];

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
function zoomToMunicipality(munKey) {
  // munKey is a composite key (cityKey output): "NEWARK CITY" or "WASHINGTON TWP|GLOUCESTER".
  const bounds = boundaryBoundsByMun[munKey];
  if (!bounds) return;

  // Detect mobile
  const isMobile = window.innerWidth <= 768;

  // Cities that need extra zoom boost (geographically smaller or elongated)
  const tightCities = ["NEWARK CITY","ELIZABETH CITY","TRENTON CITY",
                       "PATERSON CITY","ASBURY PARK CITY","ATLANTIC CITY"];
  const isTight = tightCities.includes(munKey);

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
  // Iterate the indexed boundary features (keyed by composite key) and return the
  // matching municipality as { mun, county } so same-named townships resolve correctly.
  for (const feature of Object.values(boundaryFeaturesByMun)) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    const props = feature.properties || {};
    const hit =
      (geometry.type === 'Polygon' && isPointInPolygon(coords, geometry.coordinates)) ||
      (geometry.type === 'MultiPolygon' && geometry.coordinates.some(polygon => isPointInPolygon(coords, polygon)));
    if (hit) return { mun: props.MUN, county: props.COUNTY || null };
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

function setActiveCitySelection(sel) {
  // Accept a MUN name ("NEWARK CITY"), a display label ("Newark"), or an object
  // { mun, county } (from the search suggestion or point-in-polygon geocoder).
  let mun = null;
  let county = null;
  if (sel && typeof sel === 'object') {
    mun = sel.mun || null;
    county = sel.county || null;
  } else {
    mun = _validCities.includes(sel) ? sel : resolveMunFromInputValue(sel);
  }
  if (!mun) return;

  closeSelectedAssetPopup();
  removeHoverPopup();
  activeCity = mun;
  activeCounty = resolveCounty(mun, county ? String(county).toUpperCase() : null);

  const desktopSelect = document.getElementById('municipality-select');
  const mobileSelect = document.getElementById('mobile-municipality-select');
  const label = cityDisplay(activeCity, activeCounty);
  if (desktopSelect) desktopSelect.value = label;
  if (mobileSelect) mobileSelect.value = label;

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
  zoomToMunicipality(activeKey());
  updateMunicipalityLabel();

  if (blueAcresVisible) {
    updateBlueAcresHighlight();
    updateBlueAcresStats();
  }

  if (typeof updateMobileFinding === 'function') updateMobileFinding();
  if (typeof updateMobileBlueAcresStats === 'function') updateMobileBlueAcresStats();
}

// Deactivate city selection — used when a geocoder search lands outside of New Jersey
// (or any address that doesn't match a NJ municipality).
// Clears the dropdown, hides all city-specific layers, and hides the finding card.
function deactivateCity() {
  closeSelectedAssetPopup();
  removeHoverPopup();
  activeCity = null;
  activeCounty = null;

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
    .map(munName => {
      const label = formatMunLabel(munName);
      const normalizedLabel = normalizeCityName(label);
      // Unique-named cities key their bounds by name; same-named towns are handled
      // by the typeahead search instead of this address-geocoder helper.
      const bounds = boundaryBoundsByMun[munName];
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
            analyzed_city_key: munName
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
  const cityDisplayName = cityDisplay(activeCity, activeCounty) || activeCity;
  el.textContent = cityDisplayName;
  updateFactSheetButtons();

  // Re-show the finding card when switching cities (in case user closed it)
  const card = document.getElementById('finding-card');
  if (card) card.style.display = '';
}

function updateFactSheetButtons() {
  const cityDisplayName = cityDisplay(activeCity, activeCounty) || '';
  const href = getFactSheetUrl(activeCity, activeCounty);
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
      const href = getFactSheetUrl(activeCity, activeCounty) || btn.getAttribute('href');
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
        setFactSheetStatus('', { persist: false });
      }, 2200);
    });
  });
}

function updateMapFindings(overallTotal, total2025, total2050, pctRisk2025, pctRisk2050) {
  const el = document.getElementById('finding-text');
  if (!el) return;

  // Use CSV findings if available for this city
  const csvOverall = municipalityOverall[activeKey()];
  if (csvOverall && csvOverall.finding) {
    el.innerHTML = csvOverall.finding;
    return;
  }

  // Fallback: generate sentence if CSV finding is missing
  if (overallTotal === 0) {
    const cityDisplayName = cityDisplay(activeCity, activeCounty) || activeCity || 'this municipality';
    el.innerHTML = `No public assets in the mapped dataset fall inside the 2050 floodplain for ${cityDisplayName}.`;
    return;
  }

  const cityDisplayName = cityDisplay(activeCity, activeCounty) || activeCity;

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
    filter: munFilter()
  });
  
  // ---- Precompute boundary bounds for zoom function ----
  fetch('data/boundary.json')
    .then(res => res.json())
    .then(geojson => {
      geojson.features.forEach(f => {
        const mun = f.properties?.MUN;
        if (!mun || mun === 'PINE VALLEY BORO') return;  // Pine Valley dissolved 2022
        const county = f.properties?.COUNTY;
        const key = cityKey(mun, county);

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

        // Keyed by composite key so each same-named township has its own bounds/feature.
        boundaryBoundsByMun[key] = bounds;
        boundaryFeaturesByMun[key] = f;
      });

      // Initial zoom after bounds are ready
      zoomToMunicipality(activeKey());
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
      filter: munFilter()
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
    removeHoverPopup();
  });

  map.on('mousemove', 'blueacres-fill', e => {
    if (!e.features.length) return;
    const f = e.features[0];
    const name = f.properties.NAME_LABEL || f.properties.FEE_SIMPLE || 'Blue Acres Parcel';
    const use = f.properties.USE_LABEL || '';
    const acres = f.properties.GISACRES ? parseFloat(f.properties.GISACRES).toFixed(2) : '';
    const date = f.properties.PRESERVATI || '';
    const muni = f.properties.MUNICIPALI || '';

    removeHoverPopup();
    hoverPopup = new mapboxgl.Popup({ closeButton: false, offset: 10 })
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

    if (selectedAssetPopup) {
      removeHoverPopup();
      return;
    }

    removeHoverPopup();

    if (features.length) {
      const f = features[0];
      hoverPopup = new mapboxgl.Popup({
        className: 'asset-hover-popup',
        closeButton: false
      })
        .setLngLat(f.geometry.coordinates)
        .setHTML(buildAssetPopupHtml(f))
        .addTo(map);
    }
  });

  ['assets_2025', 'assets_2050'].forEach((layerId) => {
    map.on('mouseleave', layerId, () => {
      if (!selectedAssetPopup) removeHoverPopup();
    });

    map.on('click', layerId, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      openSelectedAssetPopup(feature);
    });
  });

  map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ['assets_2025', 'assets_2050']
    });

    if (!features.length) {
      closeSelectedAssetPopup();
    }
  });
  
  // ---- Municipality typeahead event ----
  // The input is a <datalist>-backed text field; users can either pick a
  // suggestion (value = display label) or type a custom value. setActiveCitySelection
  // handles both MUN keys and display labels via resolveMunFromInputValue.
  document.getElementById('municipality-select').addEventListener('change', e => {
    const raw = e.target.value;
    const resolved = resolveMunFromInputValue(raw);
    if (resolved) {
      setActiveCitySelection(resolved);
    } else if (raw && raw.trim()) {
      // Typed a muni we don't recognize — snap back to current activeCity's label
      // so the input doesn't stay in a broken state.
      e.target.value = activeCity ? cityDisplay(activeCity, activeCounty) : '';
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

  if (geocoderContainer) {
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

      // Strategy 2: Point-in-polygon — do the coordinates land inside any NJ municipality?
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
        const markerEl = geocoderContainer.querySelector('.mapboxgl-marker');
        if (markerEl) markerEl.style.display = 'none';

        setActiveCitySelection(matchedCity);
        if (findingCard) findingCard.style.display = '';
      } else {
        // No match — the address is likely outside New Jersey. Deactivate everything
        // and show an explanatory popup at the searched location.
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
        const markerEl = geocoderContainer.querySelector('.mapboxgl-marker');
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
            <strong>Outside New Jersey</strong><br/>
            This address doesn't fall within a New Jersey municipality.
            Try searching an NJ address or pick a municipality from the list.
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
      const markerEl = geocoderContainer.querySelector('.mapboxgl-marker');
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

  const cityDisplayName = cityDisplay(activeCity, activeCounty) || activeCity;

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
        filter: munFilter()
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

    const cityName = cityDisplay(activeCity, activeCounty) || activeCity;
    const cleanCityName = cityName.replace(/[()]/g, '').replace(/\s+/g, '_');
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
      const raw = e.target.value;
      const resolved = resolveMunFromInputValue(raw);
      if (resolved) {
        setActiveCitySelection(resolved);
      } else if (raw && raw.trim()) {
        e.target.value = activeCity ? cityDisplay(activeCity, activeCounty) : '';
      }
    });
  }

  // Keep mobile select in sync when desktop select changes
  if (desktopSelect) {
    desktopSelect.addEventListener('change', () => {
      if (mobileSelect && activeCity) mobileSelect.value = cityDisplay(activeCity, activeCounty);
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

    const csvOverall = municipalityOverall[activeKey()];
    if (csvOverall && csvOverall.finding) {
      el.innerHTML = csvOverall.finding;
      return;
    }

    // Fallback: use computed counts from CSV overall if present; otherwise
    // mirror the desktop finding text element (which loadLayers populates from
    // the map itself for munis without CSV data).
    const cityDisplayName = cityDisplay(activeCity, activeCounty) || activeCity;
    if (csvOverall) {
      el.innerHTML = `
        Of <strong>${csvOverall.total}</strong> public assets in ${cityDisplayName},
        <strong>${csvOverall.risk2025}</strong> are in the floodplain today &mdash;
        <span class="finding-2050">rising to ${csvOverall.risk2050} by 2050</span>
        (${csvOverall.pct2050} of all assets).
      `;
    } else if (!activeCity) {
      el.innerHTML = `Select a city to see flood exposure findings.`;
    } else {
      // Copy whatever the desktop finding element is showing for this muni
      const desktopText = document.getElementById('finding-text');
      el.innerHTML = desktopText && desktopText.innerHTML
        ? desktopText.innerHTML
        : `Flood exposure findings for ${cityDisplayName} are being calculated from the map.`;
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
    const cityDisplayName = cityDisplay(activeCity, activeCounty) || activeCity;

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
