const puppeteer = require("puppeteer");
const request = require("requestretry");
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config.json");

const scrapeUrls = config.scrapeURLs;

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

        // If a custom browser path is set, make puppeteer use it.
        if (!!config.customBrowserPath) launchSettings.executablePath = config.customBrowserPath;

        const browser = await puppeteer.launch(launchSettings);

        const page = await browser.newPage();
        
        console.log("Beginning scraping process...");

        const allListings = [];

        let atUrl = 1;
        for (const url of scrapeUrls) {
            console.log(`[${atUrl}/${scrapeUrls.length}] Scraping URL '${url}'`);

            await page.goto(url, {
                waitUntil: "networkidle2",
                timeout: 30000,
            });

            // Take screenshot if enabled in config.
            if (config.saveScreenshots) await page.screenshot({"path": `URL_${atUrl}_Start.png`});

            await page.waitForSelector("#seo_pivots");

            const scrapedCarListings = await page.evaluate(async() => {
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

            // Take screenshot if enabled in config.
            if (config.saveScreenshots) await page.screenshot({"path": `URL_${atUrl}_End.png`});

            // Add listings from page to main array, if it is not a duplicate.
            for (const scrapedListing of scrapedCarListings) {
                // If the same URL is found in the main array, do not add.
                if (allListings.find(listing => listing.url === scrapedListing.url)) continue;

                allListings.push(scrapedListing);
            }

            atUrl += 1;
        }

        await page.close();
        await browser.close();

        console.log("Scraping complete.");

        resolve(allListings);
    });
}

let restartInterval = null;
async function Main() {
    // Clear interval if it has been set - handle script reruns.
    if (restartInterval) clearInterval(restartInterval);

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
            listing["lastChecked"] = Date.now();
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

        listing["lastChecked"] = Date.now();
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
    dateToRestart.setMinutes(dateToRestart.getMinutes() + config.checkInterval);
    restartInterval = setInterval(displayRestartTimer, 1000);
}
Main();

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

    // End process immediately after completion if configured.
    if (!config.restartOnComplete && config.endImmediately) process.exit(0);
    
    // Only show timer and logs every interval is enabled in config.
    if (config.showTimers) {
        console.clear();
        console.log(`Scraping & logging complete. ${(config.restartOnComplete) ? "Restarting script" : "Ending process"} in ${config.checkInterval} minutes.`);
        console.log(`Restarts in: ${("0"+Math.floor(timeDiff/1000/60/60)).slice(-2)}:${("0"+Math.floor(timeDiff/1000/60)%60).slice(-2)}:${("0"+Math.floor(timeDiff/1000)%60).slice(-2)}`);
        // Display different message depending on whether the script restarts within the process, or if the process ends.
        console.log((config.restartOnComplete) ? "Script will keep running until an error occurs, or is manually closed." : "\nProcess will exit after this ends. It is recommended that a batch file (or similar) restarts the script when it exits.");
    }

    // When the 3 hours has passed, exit process (or rerun script).
    if (timeDiff <= 0) {
        // Don't worry about an 'else' statement, since the process exits so it won run anyway.
        if (!config.restartOnComplete) process.exit(0);

        Main();
    }
}