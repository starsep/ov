const META_KEY_TYPE = "_type";
const META_KEY_PLACE = "_place";
const META_KEY_AREA = "_area";
const META_KEY_NAMES = "_names";

function renderData(data, meta) {
    const elements = data.elements.filter(element => element.tags !== undefined);
    const nodes = elements.filter(element => element.type === "node") // TODO: handle other types
    if (nodes.length === 0) return; // TODO: no data error
    function average(a) {
        return a.reduce((acc, value) => acc + value, 0) / a.length;
    }
    const lat = average(nodes.map(node => node["lat"]))
    const lon = average(nodes.map(node => node["lon"]));

    const map = L.map('map', {
        center: [lat, lon],
        zoom: 14 // TODO: calculate zoom
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);

    function tagsToHtml(tags) {
        return Object.entries(tags)
            .map(([key, value]) => `<b>${key}</b>=${value}<br/>`)
            .reduce((acc, value) => acc + value, "")
    }

    nodes.forEach(node => {
        const marker = L.marker([node["lat"], node["lon"]])
            .bindPopup(tagsToHtml(node["tags"]))
        if (meta[META_KEY_NAMES] !== undefined && node["tags"]["name"]) {
            marker.bindTooltip(node["tags"]["name"], {permanent: true, direction : 'right'})
        }
        marker.addTo(map);
    });
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

async function replacePlaceWithArea(meta) {
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
    const url = "https://overpass-api.de/api/interpreter";
    const form = new FormData();
    form.set("data", query)
    return await fetch(url, {
        body: query,
        method: "POST"
    }).then(x => x.json())
}

async function main() {
    const {tags, meta} = parseData();
    const metaArea = await replacePlaceWithArea(meta);
    const overpassQuery = buildOverpassQuery(tags, metaArea);
    const overpassData = await fetchOverpassData(overpassQuery);
    renderData(overpassData, meta);
}


main().then();