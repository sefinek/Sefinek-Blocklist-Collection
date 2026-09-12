[//]: # (Canonical: /docs/CHANGELOG.md)

# 📦 Changelog - Sefinek Blocklist Collection
To stay up to date with the latest changes, list updates, and information about added or removed sources, join our [Discord server](https://discord.gg/38gCM3agfa).
We post upcoming changes, technical details about updates, and information about any issues and how to resolve them.
It is also the place where you can suggest new lists, report bugs or false positives, and share your feedback about the project.  
The project follows semantic versioning. Thank you for using Sefinek Blocklists!


## Version 0.24.0 from 12.09.2026
1. Enabled edge caching on Cloudflare for the most popular blocklist files (`/generated/v1/*.txt`/`.conf`) - typical, smaller lists now download **~80% faster** (about 5x), especially for users geographically far from the main server (New York). Very large files (70-100 MB) benefit too, though less noticeably, since at that size client bandwidth becomes the bottleneck rather than distance to the origin.
2. Download statistics remain 100% accurate regardless of whether a file was served from the edge cache or directly from the origin.
3. Added verification of known good bots (Googlebot, Bingbot, etc.) by IP address, instead of relying solely on the User-Agent header.
4. Introduced automatic monitoring of the Cloudflare Workers daily request cap - if usage approaches the limit, some routes are temporarily removed from the cache and gradually restored on their own the next day.
5. Numerous performance and stability improvements to the cache management pipeline.


## Version 0.23.0 from 19.04.2026
1. Optimized the list generation workflow, resulting in faster performance and more consistent outputs. Additional improvements were introduced to enhance overall system reliability.
2. From now on, every list (including external ones) includes a header at the very top. It contains key information such as title, description, license, and other relevant data.
3. Introduced a series of minor fixes and optimizations that collectively improve project quality, system stability, and overall user experience.


## Version 0.22.1 from 16.04.2026
1. Removed `sites/lgbtqplus2.txt` and other lists that were automatically generated using regexes based on external sources.
2. Optimized the list generation process.
3. Cleaned up the code and improved its quality.


## Version 0.22.0 from 15.04.2026
1. Removed redundant and outdated blocklist sources:
   - `BrigsLabs/judol`
   - `jerryn70/GoodbyeAds`
   - `blocklistproject/youtube`
   - `anudeepND/blacklist`
   - `0Zinc/easylists-for-pihole`
   - `justdomains/adguarddns-justdomains`
   - `StevenBlack/fakenews-gambling-porn`
   - `FadeMind/hosts.extras`
   - `marktron/fakenews`
   - `deathbybandaid/piholeparser`
   - `kboghdady/youTube_ads_4_pi-hole`
   - `4skinSkywalker/Anti-Porn-HOSTS-File`
   - `chadmayfield/my-pihole-blocklists`
2. Merged domains from `pixiv.net` and `booth.pm` into the anime list (`anime.txt`).
3. Added new lists from `hagezi/dns-blocklists`:
   - `gambling/hagezi/gambling-onlydomains.fork.txt`
   - `porn/hagezi/nsfw-onlydomains.fork.txt`
4. Improved and extended the false positive reporting system ([/false-positives](https://blocklist.sefinek.net/false-positives)) - including a confirmation email for reporters and improved form validation and appearance.
5. Fixed incorrect canonical comments in `AdGuard.md`, `dnsmasq.md`, and `RPZ.md`.
6. Updated backend dependencies.
7. Other minor quality improvements.

> Due to the removal of several blocklist sources, it is recommended to regenerate your collection at [sefinek.net/blocklist-generator](https://sefinek.net/blocklist-generator).


## Version 0.21.0 from 8.04.2026
1. Generated blocklists have been moved to a dedicated [blocklists](https://github.com/sefinek/Sefinek-Blocklist-Collection/tree/blocklists) orphan branch, keeping the `main` branch history clean and free from automated commits.
2. Sefinek's curated domain lists have been moved from `blocklists/templates/` to a new `lists/` directory directly on `main`, making them easy to browse and manage.
3. The `update-blocklists` workflow now triggers only on changes to [lists/**](https://github.com/sefinek/Sefinek-Blocklist-Collection/tree/main/lists) instead of any `.txt` file.
4. Updated `pull.sh` to sync both `main` and the `blocklists` branch via git worktree.
5. Minor frontend improvements.

> On April 8, 2026, maintenance work was carried out as part of this update's deployment - the server was unavailable for approximately 30 minutes during that time. Any errors related to downloading lists during that period can be disregarded.


## Version 0.20.0 from 17.03.2026
1. Added the ability to report false positives at [/false-positives](https://blocklist.sefinek.net/false-positives).
2. Added a sound when navigating to folders in File Explorer.
3. Fixed an issue with last modified dates in File Explorer.
4. Improved security measures.
5. Various performance improvements.
6. Fixed rate limiter counters not being shared across cluster workers.
7. Minor fixes.


## Version 0.19.0 from 3.03.2026
1. Improved the design of https://sefinek.net/blocklist-generator.
2. Added a new list: https://blocklist.sefinek.net/generated/v1/0.0.0.0/tracking-and-telemetry/sefinek.hosts.txt
3. Completely redesigned the project frontend to make it more modern and intuitive.
4. Added a new subpage [/metrics](https://blocklist.sefinek.net/metrics) with extended statistics.
5. Templates no longer use the `0.0.0.0` prefix and are now saved as standard hosts files for greater convenience.
6. Renamed: `malicious/sefinek.hosts2.txt`, `malicious/sefinek.hosts1.txt` to `malicious/sefinek.hosts.txt`.
7. Moved `crypto/sites/sefinek.hosts.txt` to `crypto/sefinek.hosts.txt`.
8. Removed the following lists:
   - malicious/digitalside/latestdomains.fork.txt
   - ads/blocklistproject/youtube.fork.txt
   - hate-and-junk/developerdan/extended.fork.txt
   - hate-and-junk/sefinek.hosts.txt
   - developerdan/amp-hosts-extended.fork.txt
   - piracy/sefinek.hosts.txt
   - malicious/suspicious.txt
9. Introduced additional improvements and optimizations.
10. And many more changes and fixes!


## Version 0.18.0 from 27.04.2025
1. Added new domain lists collected using regular expressions. See [this file](https://github.com/sefinek/Sefinek-Blocklist-Collection/blob/main/scripts/generate/file-processor/scripts/data.js) for more details.
   - `anime/main.txt`
   - `sites/lgbtqplus2.txt`
   - `gambling/sefinek.hosts2.txt`
   - `porn/sefinek.hosts2.txt`
   - `piracy/sefinek.hosts.txt`
   - `hate-and-junk/sefinek.hosts.txt`
   - `sites/esport.txt`
   - `sites/social-media.txt`
2. Updated Express.js to version 5.
3. Implemented own file-serving solution. Files are now served about 500ms faster!
4. Optimized statistics collection and reduced database load.
5. Minor quality fixes and performance improvements.
6. Enhanced the list generator UI ([sefinek.net](https://sefinek.net/blocklist-generator)).


## Version 0.17.0 from 14.07.2024
1. Added:
   - `dating-services/ShadowWhisperer/dating.fork.txt`
   - `malicious/ShadowWhisperer/malware.fork.txt`
   - `porn/ShadowWhisperer/adult.fork.txt`
   - `scam/ShadowWhisperer/scam.fork.txt`
   - `tracking-and-telemetry/ShadowWhisperer/tracking.fork.txt`
   - `dating-services/sefinek.hosts.txt`
2. The code responsible for gathering statistics has been optimized. From now on, the statistics will not impact the file serving time, etc.
3. Code cleanup and other improvements.
4. Updated dependencies to the latest versions.
5. Other fixes.


## Version 0.16.0 from 28.05.2024
1. Removed `ads/kboghdady/youtubelist.fork.txt` from the lists.
2. Added:
    - `fakenews/StevenBlack/hosts.fork.txt`
    - `gambling/StevenBlack/hosts.fork.txt`
    - `porn/StevenBlack/porn.fork.txt`
3. Pixiv will now be `checked` by default in the blocklist generator.
4. Other improvements.


## Version 0.15.1 - 22.05.2024
1. Updated all dependencies.
2. Updated Eslint to version 9.
3. Performed code cleanup.
4. Added Unbound and RPZ formats to the [lists/Index.md](https://blocklist.sefinek.net/docs/lists/Index.md) file.
5. Other improvements and fixes.


## Version 0.15.0 from 18.05.2024
1. Added support for RPZ format and Unbound. [#25](https://github.com/sefinek/Sefinek-Blocklist-Collection/issues/26)
2. Added a new blocklist `gambling/TrustPositif/gambling-indonesia.fork.txt`. [#26](https://github.com/sefinek/Sefinek-Blocklist-Collection/issues/25)
3. The scripts responsible for generating block lists have been significantly improved
4. Other quality fixes.


## Version 0.14.0 from 10.03.2024
1. The repository has been equipped with a [whitelist](https://github.com/sefinek/Sefinek-Blocklist-Collection/blob/main/whitelists/main.txt). Domains or subdomains on this list will NEVER appear in the selected blocklists.
2. Blocklists have been organized by category (the links to these lists have been changed).
3. Scripts responsible for generating the blocklists have been corrected.
4. Additional improvements have been made.


## Version 0.13.1 from 30.01.2024
1. Added [LICENSE](https://github.com/sefinek/Sefinek-Blocklist-Collection/blob/main/LICENSE).
2. Updated all dependencies.
3. Updated blocklists.
4. Other fixes and improvements.


## Version 0.13.0 from 10.12.2023
1. Updated node modules. [[59c80cf](https://github.com/sefinek/Sefinek-Blocklist-Collection/commit/59c80cf6a2aa2d786b03a2b8fdec9d47012592bd)]
2. Improved responsiveness of the block list generator.
3. Enhanced the appearance of modals.
4. Now you can download the generated collection of URL addresses.
5. Users can also send the generated collection to their email address.
6. Other fixes and improvements have been made.


## Version -.-.- from 30.11.2023
1. Added a few missing URLs.
2. Removed deprecated links.
