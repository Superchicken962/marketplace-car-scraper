const express = require("express");
const app = express();
const config = require("./config.json");
const PORT = config.webserver?.port || 3015;
const path = require("node:path");
const fs = require("node:fs");
const {default: axios} = require("axios");

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "webserver/index.html"));
});

app.get("/get/data", (req, res) => {
    const filePth = path.join(__dirname, "saved_listings.json");
    
    if (!fs.existsSync(filePth)) {
        res.sendStatus(404);
        return;
    }

    res.sendFile(filePth);
});

app.delete("/listings/invalid/all", async(req, res) => {
    const filePth = path.join(__dirname, "saved_listings.json");
    
    if (!fs.existsSync(filePth)) {
        res.sendStatus(200);
        return;
    }

    // Wrap in try-catch statement so any errors will send an error 500 to the client.
    try {
        let existingData = await fs.promises.readFile(filePth, "utf-8");
        existingData = JSON.parse(existingData);

        const newData = {};

        // Wait for the async loop/map to complete.
        await Promise.all(Object.values(existingData).map(async(data) => {
            if (!data.lastChecked) return;

            // Test image url - if it succeeds then the listing is still valid as the image works. If not, just catch the error so it does not crash and continue on with loop.
            await axios.get(data.imageUrl).then(() => {
                // If data is not invalid, add to new data object.
                newData[data.url] = data;
            }).catch(() => {}); // Empty catch to prevent fail.
        }));

        // Save new data to listings file.
        await fs.promises.writeFile(filePth, JSON.stringify(newData), "utf-8");

        // Finally respond with OK.
        res.sendStatus(200);

    } catch (error) {
        console.log(error);
        res.sendStatus(500);
    }
});

app.listen(PORT, () => {
    console.log(`[Web Server] Listening on port ${PORT}`);
});