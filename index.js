import axios from "axios";
import fs from "fs";

// Function to geocode the address using OpenStreetMap's Nominatim API
const geocodeAddress = async (address) => {
  const encodedAddress = encodeURIComponent(address);
  const geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodedAddress}&format=json&limit=1&email=cameronpaczek@gmail.com`;

  try {
    console.log("Geocoding address:", address);
    const response = await axios.get(geocodeUrl, {
      headers: {
        "User-Agent": "GIS Search/1.0 (cameronpaczek@gmail.com)",
      },
    });
    // get zip

    console.log("Geocode response:", response.data);
    if (response.data.length > 0) {
      const { lat, lon } = response.data[0];
      console.log(`Geocoded lat: ${lat}, lon: ${lon}`);

      const reverseUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18&addressdetails=1`;

      const reverseResponse = await axios.get(reverseUrl, {
        headers: {
          "User-Agent": "GIS Search/1.0 (cameronpaczek@gmail.com)",
        },
      });
      console.log("Reverse geocode response:", reverseResponse.data);
      // somtimes responts.data is array sometimes its just an object lets normalize it
      const addressData = Array.isArray(reverseResponse.data)
        ? reverseResponse.data[0]
        : reverseResponse.data;

      return {
        lat,
        lon,
        // isNotPlace: addressData.class !== "place",
        zip: reverseResponse.data.address.postcode,
      };
    } else {
      throw new Error("Address not found");
    }
  } catch (err) {
    console.error("Error geocoding address:", err);
    throw err;
  }
};

// Function to query the ArcGIS REST API
const queryArcGIS = async (address, lat, lon, zip) => {
  const queryUrl =
    "https://gis.carb.arb.ca.gov/hosting/rest/services/Hosted/Priority_Populations_2023_Update/FeatureServer/query";
  const layers = [
    { id: 0, name: "Disadvantaged_Communities_TribalLands" },
    { id: 1, name: "Buffer_Low_income_Communities" },
    { id: 3, name: "Disadvantaged_Communities_CES4" },
    { id: 5, name: "Low_income_Communities" },
    // { id: 6, name: "Buffer_Low_income_Household" },
    // { id: 7, name: "Low_income_Household" },
  ]; // Layer IDs and names to query

  try {
    console.log(`Querying ArcGIS with lat: ${lat}, lon: ${lon}`);
    const promises = layers.map((layer) =>
      axios.get(queryUrl, {
        params: {
          f: "json",
          geometry: `${lon},${lat}`,
          geometryType: "esriGeometryPoint",
          inSR: "4326",
          spatialRel: "esriSpatialRelIntersects",
          outFields: "*",
          returnGeometry: false,
          outSR: "4326",
          where: "1=1",
          layerDefs: JSON.stringify({ [layer.id]: "1=1" }),
        },
      })
    );

    const responses = await Promise.all(promises);
    // console.log(
    //   "ArcGIS query responses:",
    //   responses.map((response) => response.data)
    // );

    const result = {
      address: address,
      zip: zip,
      lat: lat,
      lon: lon,
      layers: [],
    };

    responses.forEach((response, index) => {
      const layer = layers[index];
      const layersData = response.data.layers;
      if (layersData && layersData.length > 0) {
        layersData.forEach((layerData) => {
          //   console.log(
          //     "Layer Data for " + layer.name + ":",
          //     layerData,
          //     layer.name
          //   );
          const features = layerData.features;
          if (features && features.length > 0) {
            result.layers.push(layer.name);
          }
        });
      }
    });

    return result;
  } catch (err) {
    console.error("Error querying ArcGIS:", err);
    throw err;
  }
};

const parseResults = (results) => {
  // parse results into a csv where each row is a unique zipcode and the second column is the number of adderesses in that zipcode that are apart of the layer and the third column is the number of address that are apart of that zipcode that re not apart of any layer i.e layers.length === 0. Also don't include any resutls with an error key in it
  const zipCodeMap = {};
  results.forEach((result) => {
    if (result.error) {
      return;
    }
    const { zip, layers } = result;
    if (!zipCodeMap[zip]) {
      zipCodeMap[zip] = { layers: 0, noLayers: 0 };
    }
    if (layers.length > 0) {
      zipCodeMap[zip].layers++;
    } else {
      zipCodeMap[zip].noLayers++;
    }
  });
  const csv = Object.entries(zipCodeMap)
    .map(([zip, { layers, noLayers }]) => `${zip},${layers},${noLayers}`)
    .join("\n");
  // add header
  return `ZipCode, Has Layer, No Layers\n${csv}`;
};

// Main function
const main = async () => {
  const address = "3631 Beta St, San Diego, CA 92113";
  // read address from addresses.txt file and put into an array based on new line
  const addresses = fs.readFileSync("addresses.txt", "utf8").split("\n");
  console.log("Addresses:", addresses);
  // Loop through each address and geocode it
  let results = [];
  for (const address of addresses) {
    try {
      const { lat, lon, zip } = await geocodeAddress(address);
    //   if (isNotPlace) {
    //     console.log("Not a place");
    //     results.push({ address, lat, lon, layers: [], error: "Bad Address" });
    //     continue;
    //   }
      console.log(`Geocoded address: ${lat}, ${lon}`);
      const result = await queryArcGIS(address, lat, lon, zip);
      results.push(result);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("Error:", err);
    }
  }
  console.log(results);
  fs.writeFileSync("results.json", JSON.stringify(results, null, 2));
  // parse results and write to file
  const csv = parseResults(results);
  fs.writeFileSync("results.csv", csv);

  //   try {
  //     const { lat, lon } = await geocodeAddress(address);
  //     console.log(`Geocoded address: ${lat}, ${lon}`);
  //     const result = await queryArcGIS(address, lat, lon);
  //     console.log(JSON.stringify(result, null, 2));
  //   } catch (err) {
  //     console.error("Error:", err);
  //   }
};

main();
// 3830 Gamma St, San Diego, CA 92113
// 6500 Calgary Ct, San Diego, CA 92122
// 3631 Beta St, San Diego, CA 92113
// 6505 Calgary Ct, San Diego, CA 92122
