const puppeteer = require("puppeteer");
const request = require("requestretry");
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config.json");

const scrapeUrl = config.scrapeUrl;

// Date will be changed at end to be 3 hours ahead of current time, which is when process will end to be auto restarted.
const dateToRestart = new Date();

function getListings() {
    return new Promise(async(resolve) => {
        const launchSettings = {
            "headless": "new",
            "defaultViewport": null,
            "args": [
                "--window-size=1920,1080"
            ]
        };

        // If on production, set the executable path to chromium browser as we're using linux on production server.
        if (config.production) launchSettings.executablePath = "/usr/bin/chromium-browser";

        const browser = await puppeteer.launch(launchSettings);

        const page = await browser.newPage();

        await page.goto(scrapeUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        console.log("Scraping site...");

        await page.waitForSelector("#seo_pivots");

        const carListings = await page.evaluate(async() => {
            function wait(ms) {
                return new Promise((resolve) => {
                    setTimeout(resolve, ms);
                });
            }

            let carElements = document.querySelector("#seo_pivots").nextSibling.nextSibling.nextSibling.children[0].children[1].querySelectorAll("a");
            
            // Give up to 5 tries of checking for new elements, then continue on.
            let tries = 0;
            const maxTries = 5;
            let lastCheckedElementLength = carElements.length;
            
            // Find the close button that shows on the "see more by logging in" popup, and click it if it is found.
            document.querySelector("div[aria-label='Close']")?.click();

            // 64 should be the most we will find on a page, so we keep trying until we get there or we reach the max attempts.
            while (tries < maxTries && carElements.length <= 64) {
                carElements = document.querySelector("#seo_pivots").nextSibling.nextSibling.nextSibling.children[0].children[1].querySelectorAll("a");

                // Scroll to the bottom of the page to let more cars load in.
                window.scroll(0, 50000);

                // Just wait a second to let cars load in before scrolling again.
                await wait(1000);

                lastCheckedElementLength = carElements.length;

                // If the length is the same again, increment the number of tries so that eventually if the length is the same for a while, it just gives up and returns the amount.
                if (carElements.length === lastCheckedElementLength) {
                    tries++;
                }
            }

            carElements = document.querySelector("#seo_pivots").nextSibling.nextSibling.nextSibling.children[0].children[1].querySelectorAll("a");

            const carsList = [];

            for (const linkElement of carElements) {
                // Remove the mess of query variables that is in facebook URLs.
                let url = linkElement.href.split("?")[0];

                let info = linkElement.children[0].children[1];

                let price = info.children[0].textContent.split("AU$");
                let name = info.children[1].textContent;
                let location = info.children[2].textContent;
                let kilometers = info.children[3].textContent;

                let imageUrl = linkElement.children[0].children[0].querySelector("img").src;

                price.shift();

                const carInfo = {
                    price: {
                        old: price[1],
                        current: price[0]
                    },
                    name, 
                    location, 
                    kilometers, 
                    url,
                    imageUrl
                };
                carsList.push(carInfo);
            }

            return carsList;
        });

        // await page.screenshot({"path": "test.png"})

        await page.close();
        await browser.close();

        console.log("Scraping complete.");

        resolve(carListings);
    });
}


(async() => {
    const listings = await getListings();
    let completionMessage = "Update complete.";

    const listings_path = path.join(__dirname, "saved_listings.json");
    let saved_listings = {};

    // If the file exists, read it and set it as saved listings variable. Otherwise the variable will just be empty.
    if (fs.existsSync(listings_path)) {
        try {
            saved_listings = JSON.parse(fs.readFileSync(listings_path, "utf-8"));
        } catch (error) {}
    }

    let listingNum = 1;
    // Will be incremented after every discord webhook request, and used to determine if anything was updated in the end.
    let requestsMade = 0;

    // Loop through listings and check then post to discord if updated.
    for (const listing of listings) {
        // If the listing has already been saved (sent to discord previously), and the prices haven't changed then do not send the webhook as nothing has changed or updated.
        if (saved_listings[listing.url] && saved_listings[listing.url].price.current === listing.price.current) {
            listingNum++; // Increment just to add progress.
            continue;
        };

        if (config.showTimers) {
            console.clear();
            console.log("-Scraping complete\n");
            console.log(`Sending Discord webhook for listing ${listingNum}/${listings.length}`);
            console.log(`${Math.floor((listingNum/listings.length)*100)}% Complete.`);
        }

        const webhook = {
            "content": "<@!406973124719149056>"
        };

        const embed = {
            "title": listing.name,
            "footer": {"text": listing.location},
            "timestamp": new Date().toISOString(),
            "url": listing.url
        };
        
        // Price differs between saved listing, and fetched listing - Update webhook for "price update"
        if (saved_listings[listing.url] && saved_listings[listing.url].price.current !== listing.price.current) {
            webhook.username = `Listing - Price change (${listing.name})`;
            embed.color = 0x3d8eff;
            embed.fields = [
                {"name": "Kilometers", "value": listing.kilometers},
                {"name": "Price", "value": `${saved_listings[listing.url].price.current} => ${listing.price.current}`}
            ];
        } else if (!saved_listings[listing.url]) {
            // Handle new listings.
            webhook.username = "New listing found!";
            embed.color = 0x3d8eff;
            embed.fields = [
                {"name": "Kilometers", "value": listing.kilometers},
                {"name": "Price", "value": `${listing.price.current}`}
            ];
        }

        // If the listing has an image url, add the image to the embed.
        if (listing.imageUrl) {
            embed.image = {
                url: listing.imageUrl
            };
        }

        // Attach embed to webhook.
        webhook.embeds = [embed];
        
        listingNum++;

        await request({
            url: config.webhooks.listings,
            method: "POST",
            json: webhook
        }).catch((err) => {
            console.error("Error sending webhook to Discord:", err);
            resolve();
        });

        requestsMade++;
    }

    // Just wait 2s before sending completion message to ensure it is sent after everything else.
    await wait(2000);

    if (requestsMade === 0) completionMessage = "No updates to price / or new listings found.";
    else completionMessage = `Update complete - found ${requestsMade} new/updated listings.`;

    // Send a 'completion' message.
    await request({
        url: config.webhooks.listings,
        method: "POST",
        json: {"content": `[<t:${Math.floor(Date.now()/1000)}:R>] ${completionMessage}`}
    }).catch((err) => {
        console.error("Error sending webhook to Discord:", err);
        resolve();
    });

    // Save data to file
    fs.writeFileSync(listings_path, JSON.stringify(formatListingsForSave(listings, saved_listings)), "utf-8");

    // Set hours to 3 hours in future.
    dateToRestart.setHours(dateToRestart.getHours() + 3);
    setInterval(displayRestartTimer, 1000);
})();

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Format listings array into object where URLs are the keys.
 * @param { Array } listings Array of listings
 * @param { Object? } saved_listings - Existing listings object for new listings to be added to (optional).
 * @returns { Object } Formatted object
 */
function formatListingsForSave(listings, saved_listings = {}) {
    for (const listing of listings) {
        saved_listings[listing.url] = listing;
    }

    return saved_listings;
}

function displayRestartTimer() {
    const timeDiff = dateToRestart.getTime() - Date.now();
    
    // Only show timer and logs every interval is enabled in config.
    if (config.showTimers) {
        console.clear();
        console.log("Scraping & logging complete. Ending process in 3 hours.");
        console.log(`Restarts in: ${("0"+Math.floor(timeDiff/1000/60/60)).slice(-2)}:${("0"+Math.floor(timeDiff/1000/60)%60).slice(-2)}:${("0"+Math.floor(timeDiff/1000)%60).slice(-2)}`);
        console.log("\nProcess should ideally restart after this ends.");
    }

    // When the 3 hours has passed, exit the process.
    if (timeDiff <= 0) process.exit(0);
}