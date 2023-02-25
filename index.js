const META_KEY_TYPE = "_type";
const META_KEY_PLACE = "_place";
const META_KEY_AREA = "_area";
const META_KEY_NAMES = "_names";

function setLoadingVisibility(visible) {
    document.getElementById("loader").hidden = !visible;
}

function showMap() {
    const map = L.map('map', {
        center: [52.231, 21.006],
        zoom: 14,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    return map;
}

function renderData(map, data, meta) {
    const elements = data.elements;
    const nodesMap = new Map();
    elements
        .filter(element => element.type === "node")
        .forEach(node => nodesMap.set(node["id"], node));
    const features = elements.filter(element => element.tags !== undefined);
    const markersGroup = new L.FeatureGroup();
    const nodeFeatures = features.filter(element => element.type === "node");
    const wayFeatures = features.filter(element => element.type === "way");
    // TODO: handle other relations?
    if (nodeFeatures.length + wayFeatures.length === 0) return; // TODO: no data error
    function tagsToHtml(tags) {
        return Object.entries(tags)
            .map(([key, value]) => `<b>${key}</b>=${value}<br/>`)
            .reduce((acc, value) => acc + value, "")
    }

    function showMarker(latLon, tags) {
        const marker = L.marker(latLon).bindPopup(tagsToHtml(tags))
        if (meta[META_KEY_NAMES] !== undefined && tags["name"]) {
            marker.bindTooltip(tags["name"], {permanent: true})
        }
        markersGroup.addLayer(marker);
    }

    nodeFeatures.forEach(node => {
        showMarker([node["lat"], node["lon"]], node["tags"]);
    });
    wayFeatures.forEach(way => {
        const coords = way.nodes.map(nodeId => nodesMap.get(nodeId)).map(node => [node["lat"], node["lon"]]);
        const polygon = L.polygon(coords, {color: "blue"}).addTo(map);
        showMarker(polygon.getBounds().getCenter(), way["tags"]);
    });
    markersGroup.addTo(map);
    map.fitBounds(markersGroup.getBounds());
}

function parseData() {
    const tags = {};
    const meta = {};
    for (const [key, value] of new URLSearchParams(location.search).entries()) {
        if (key.startsWith("_")) {
            meta[key] = value;
        } else {
            tags[key] = value;
        }
    }
    if (meta[META_KEY_TYPE] === undefined) meta[META_KEY_TYPE] = "nwr";
    return {tags, meta};
}

async function replacePlaceWithArea(map, meta) {
    if (meta[META_KEY_PLACE] === undefined) return meta;
    const place = meta[META_KEY_PLACE];
    const data = await fetch(`https://nominatim.openstreetmap.org/search?q=${place}&format=json`, {
        headers: {
            "User-Agent": "https://starsep.com/ov"
        }
    }).then(x => x.json());
    // TODO: handle error no results
    const bestPlace = data.filter(item => item["osm_id"] !== "node")[0];
    let areaId = 1 * bestPlace["osm_id"];
    if (bestPlace["osm_type"] === "way") areaId += 2400000000;
    if (bestPlace["osm_type"] === "relation") areaId += 3600000000;
    const result = { ...meta, [META_KEY_AREA]: areaId }
    delete result[META_KEY_PLACE];
    return result;
}

function buildOverpassQuery(tags, meta) {
    const tagsSelector = Object.entries(tags).map(([tag, value]) => value === "" ? `["${tag}"]` : `["${tag}"="${value}"]`);
    return `
        [out:json][timeout:25];
        area(id:${meta[META_KEY_AREA]})->.searchArea;
        (
          ${meta[META_KEY_TYPE]}${tagsSelector}(area.searchArea);
        );
        out body;
        >;
        out skel qt;
    `;
}

async function fetchOverpassData(query) {
    const overpassHost = "https://overpass-api.de";
    const url = overpassHost + "/api/interpreter";
    const form = new FormData();
    form.set("data", query)
    return await fetch(url, {
        body: query,
        method: "POST"
    }).then(x => x.json())
}

async function main() {
    setLoadingVisibility(true);
    const map = showMap();
    const {tags, meta} = parseData();
    const metaArea = await replacePlaceWithArea(map, meta);
    const overpassQuery = buildOverpassQuery(tags, metaArea);
    const overpassData = await fetchOverpassData(overpassQuery);
    renderData(map, overpassData, meta);
    setLoadingVisibility(false);
}


main().then();