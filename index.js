const META_KEY_TYPE = "_type";
const META_KEY_PLACE = "_place";
const META_KEY_AREA = "_area";
const META_KEY_NAMES = "_names";
const META_KEY_ICON = "_icon";
const META_KEY_BASEMAP = "_basemap";
const META_KEY_WMS = "_wms";
const META_KEY_WMS_URL = "_wms_url";
const META_KEY_WMS_LAYERS = "_wms_layers";

const WMS_LIST = {
    "WAW": "https://mapa.um.warszawa.pl/mapviewer/wms",
}

const BASEMAP_LIST = {
    "OPNVKarte": "https://tileserver.memomaps.de/tilegen/{z}/{x}/{y}.png",
}

function setLoadingVisibility(visible) {
    document.getElementById("loader").hidden = !visible;
}

function showMap(meta) {
    document.getElementById("form").hidden = true;
    document.getElementById("map").hidden = false;
    const map = L.map('map', {
        center: [52.231, 21.006],
        zoom: 14,
    });
    const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    console.log(META_KEY_BASEMAP, meta[META_KEY_BASEMAP], BASEMAP_LIST[meta[META_KEY_BASEMAP]])
    if (meta[META_KEY_WMS_URL] !== undefined && meta[META_KEY_WMS_LAYERS] !== undefined) {
        L.tileLayer.wms(meta[META_KEY_WMS_URL], {
            layers: meta[META_KEY_WMS_LAYERS]
        }).addTo(map);
    } else if (meta[META_KEY_BASEMAP] !== undefined && BASEMAP_LIST[meta[META_KEY_BASEMAP]] !== undefined) {
        L.tileLayer(BASEMAP_LIST[meta[META_KEY_BASEMAP]], {attribution: osmAttribution}).addTo(map);
    } else {
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution: osmAttribution}).addTo(map);
    }
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

    const iconMarker = meta[META_KEY_ICON] ? L.ExtraMarkers.icon({
        icon: meta[META_KEY_ICON],
        markerColor: "blue",
        shape: "square",
        prefix: "fa", // TODO: allow more icon customization?
    }) : null;

    function showMarker(latLon, tags) {
        const marker = iconMarker ? L.marker(latLon, {icon: iconMarker}) : L.marker(latLon);
        marker.bindPopup(tagsToHtml(tags));
        if (meta[META_KEY_NAMES] !== undefined && tags["name"]) {
            marker.bindTooltip(tags["name"], {permanent: true});
        }
        markersGroup.addLayer(marker);
    }

    nodeFeatures.forEach(node => {
        showMarker([node["lat"], node["lon"]], node["tags"]);
    });
    wayFeatures.forEach(way => {
        const coords = way.nodes.map(nodeId => nodesMap.get(nodeId)).map(node => [node["lat"], node["lon"]]);
        const wayObject = (coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1])
            ? L.polygon(coords, {color: "blue"})
            : L.polyline(coords, {color: "blue"});
        wayObject.addTo(map);
        showMarker(wayObject.getBounds().getCenter(), way["tags"]);
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
    if (meta[META_KEY_WMS] !== undefined && WMS_LIST[meta[META_KEY_WMS]] !== undefined) {
        meta[META_KEY_WMS_URL] = WMS_LIST[meta[META_KEY_WMS]];
    }
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
    const tagsSelector = Object.entries(tags).map(([tag, value]) => value === "" ? `["${tag}"]` : `["${tag}"="${value}"]`).join("");
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
    const {tags, meta} = parseData();
    if (Object.entries(tags).length === 0) return;
    setLoadingVisibility(true);
    const map = showMap(meta);
    const metaArea = await replacePlaceWithArea(map, meta);
    const overpassQuery = buildOverpassQuery(tags, metaArea);
    const overpassData = await fetchOverpassData(overpassQuery);
    renderData(map, overpassData, meta);
    setLoadingVisibility(false);
}

function onFormSubmit() {
    const keysCount = document.getElementsByClassName("keyInput").length;
    const place = document.getElementById("place").value;
    let tagsString = "";
    for (let i = 0; i < keysCount; i++) {
        const key = encodeURIComponent(document.getElementById(`key${i}`).value);
        const value = encodeURIComponent(document.getElementById(`value${i}`).value);
        if (key.length > 0) tagsString += `&${key}=${value}`;
    }
    window.location.href = `?${META_KEY_PLACE}=${place}${tagsString}`;
}

function addTagKeyInput() {
    const keysCount = document.getElementsByClassName("keyInput").length;
    const lastValueElement = document.getElementById(`value${keysCount - 1}`);
    const newKeyInput = document.createElement("input");
    newKeyInput.type = "text";
    newKeyInput.id = `key${keysCount}`;
    newKeyInput.name = `key${keysCount}`;
    newKeyInput.className = "keyInput";
    newKeyInput.placeholder = "key";
    const newValueInput = document.createElement("input");
    newValueInput.type = "text";
    newValueInput.id = `value${keysCount}`;
    newValueInput.name = `value${keysCount}`;
    newValueInput.className = "valueInput";
    newValueInput.placeholder = "value";
    lastValueElement.insertAdjacentElement("afterend", newValueInput);
    lastValueElement.insertAdjacentElement("afterend", newKeyInput);
    lastValueElement.insertAdjacentElement("afterend", document.createElement("br"));
}


main().then();
