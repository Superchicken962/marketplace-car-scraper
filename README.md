# marketplace-car-scraper
Script to fetch car listings from Facebook marketplace URL(s)

> [!WARNING]
> No longer maintained by me as I do not need to use it anymore.

## Installation
1. Ensure you have [Node.js](https://nodejs.org/en) installed - tested on v20.9.0
2. Download source code from github
3. Run `npm install` in folder with `package.json`
4. Configure scripts in `config.json` - especially scrapeUrls and webhook.

> [!NOTE]
> Tested and works well on Windows 10. Tested on Ubuntu, but did not work as facebook wants it to sign in.  
> Feel free to fork/clone and add your own features & changes!

## Usage
1. Open command prompt/terminal and go to the directory with `index.js`
2. Run `node index.js` to start the script
3. Run `node webserver.js` to start the web dashboard (runs on port 3015 by default) 

> [!TIP]
> Create batch (.bat) files to auto restart scripts. Sample auto-restart script provided below.

## Auto-restart batch script.
If you have configured the process to end after each script run, then it is recommended you use a batch script (or similar) to auto restart. A batch script is provided below.
```bat
@echo off
set /A counter=1
:run
cls
echo Running scrape script: (Run %counter%)
node index.js
set /a counter+=1
goto run
```
> Restarts the script until command prompt/terminal is closed. Displays a counter of times the script has been ran.

> [!CAUTION]
> Try not to scrape too often, otherwise facebook may screw you up!  
> If Facebook changes the layout, the scraping may stop working.

## Configuring
There are a few configurations you can make to the script. Possible configurations are listed below (with variable types):
- `scrapeURLs : string[]` - Array of Facebook marketplace URLs to scrape.
- `webhooks.listings : string[]` - Discord webhook to send listings to.
- `showTimers: bool` - Choose whether to display end timer to the console.
- `checkInterval : int` - Time (in minutes) between marketplace checks.
- `customBrowserPath : string` - Specify a custom browser path to use for scraping with puppeteer. 
- `webserver.port : int` - Port for webserver to listen on (default: 3015).
- `saveScreenshots : bool` - Choose whether to take a screenshot of marketplace before & after scraping each URL. Useful for debugging scraping problems.
- `restartOnComplete : bool` - Choose whether to rerun the fetching within the script after the `checkInterval`, or just end the process.
- `endImmediately : bool` - If `restartOnComplete` is disabled, then setting this to `true` will end the process as soon as the fetch is complete rather than waiting.

> [!TIP]
> Add sort filter on marketplace to sort by newest listings, and also add a few URLs for the script to scrape for maximum results!