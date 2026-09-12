const router = require('express').Router();

const BASE_DIRS = {
	'0.0.0.0': {},
	'127.0.0.1': {},
	'noip': {},
	'adguard': {},
	'dnsmasq': {},
	'rpz': {},
	'unbound': { ext: '.conf' },
};

const ROUTES = [
	// Ads
	{ url: '/ads/blocklistproject.ads.txt', file: 'ads/blocklistproject/hosts.fork.txt' },
	{ url: '/ads/yoyo.AdsTrackersEtc.txt', file: 'ads/yoyo/ads-trackers-etc.fork.txt' },
	{ url: '/forks/ShadowWhisperer.Ads.txt', file: 'ads/ShadowWhisperer/Ads.fork.txt' },
	{ url: '/forks/adaway.hosts.txt', file: 'ads/adaway/hosts.fork.txt' },
	{ url: '/forks/craiu.mobiletrackers.txt', file: 'ads/craiu/mobiletrackers.fork.txt' },
	{ url: '/forks/crazy-max.WindowsSpyBlocker.hosts-spy.txt', file: 'ads/crazy-max/spy.fork.txt' },
	{ url: '/forks/disconnectme.simple_ad.txt', file: 'ads/disconnectme/simple-ad.fork.txt' },
	{ url: '/forks/firebog.AdguardDNS.txt', file: 'ads/firebog/AdguardDNS.fork.txt' },
	{ url: '/forks/firebog.Admiral.txt', file: 'ads/firebog/Admiral.fork.txt' },
	{ url: '/forks/firebog.Easylist.txt', file: 'ads/firebog/Easylist.fork.txt' },
	{ url: '/forks/firebog.Prigent-Ads.txt', file: 'ads/firebog/Prigent-Ads.fork.txt' },

	// Tracking & telemetry
	{ url: '/forks/0Zinc.easyprivacy.txt', file: 'tracking-and-telemetry/0Zinc/easyprivacy.fork.txt' },
	{ url: '/forks/ente-dev.tv.txt', file: 'tracking-and-telemetry/ente-dev/tv.fork.txt' },
	{ url: '/forks/frogeye.firstparty-trackers-hosts.txt', file: 'tracking-and-telemetry/frogeye/firstparty-trackers-hosts.txt' },
	{ url: '/forks/MajkiIT.adguard_mobile_host.txt', file: 'tracking-and-telemetry/MajkiIT/adguard-mobile-host.fork.txt' },
	{ url: '/forks/neodevpro.neodevhost.txt', file: 'tracking-and-telemetry/neodevpro/host.fork.txt' },

	// AMP Hosts
	{ url: '/forks/ente-dev.google-amp-hosts.txt', file: 'amp/ente-dev/google-amp-hosts.fork.txt' },

	// Malicious
	{ url: '/forks/AssoEchap.stalkerware-indicators.txt', file: 'malicious/AssoEchap/stalkerware-indicators.fork.txt' },
	{ url: '/forks/bigdargon.hostsVN.txt', file: 'malicious/bigdargon/hostsVN.fork.txt' },
	{ url: '/forks/DandelionSprout-AntiMalwareHosts.txt', file: 'malicious/DandelionSprout-AntiMalwareHosts.fork.txt' },
	{ url: '/forks/disconnectme.simple_malvertising.txt', file: 'malicious/disconnectme/simple-malvertising.fork.txt' },
	{ url: '/forks/malware-filter.urlhaus-filter-hosts-online.txt', file: 'malicious/malware-filter/urlhaus-filter-hosts-online.fork.txt' },
	{ url: '/forks/quidsup.notrack-malware.txt', file: 'malicious/quidsup/notrack-malware.fork.txt' },
	{ url: '/forks/RPiList-Malware.txt', file: 'malicious/RPiList/Malware.fork.txt' },
	{ url: '/forks/Spam404.main-blacklist.txt', file: 'malicious/Spam404/main-blacklist.fork.txt' },
	{ url: '/malicious/blocklistproject.malware.txt', file: 'malicious/blocklistproject/malware.fork.txt' },
	{ url: '/malicious/main.txt', file: 'malicious/sefinek.hosts.txt' },
	{ url: '/malicious/main-2.txt', file: 'malicious/sefinek.hosts.txt' },
	{ url: '/malicious/reported-by-norton.txt', file: 'malicious/reported-by-norton.txt' },
	{ url: '/malicious/web-attacks.txt', file: 'malicious/web-attacks.txt' },

	// Phishing
	{ url: '/forks/blocklistproject.phishing.txt', file: 'phishing/blocklistproject/phishing.fork.txt' },
	{ url: '/forks/Dogino.Discord-Phishing-URLs-phishing.txt', file: 'phishing/Dogino/Discord-Phishing-URLs-phishing.fork.txt' },
	{ url: '/forks/phishingArmy.phishing_army_blocklist_extended.txt', file: 'phishing/phishing.army/blocklist-extended.fork.txt' },
	{ url: '/forks/RPiList-Phishing.txt', file: 'phishing/RPiList/Phishing-Angriffe.fork.txt' },
	{ url: '/phishing.txt', file: 'phishing/sefinek.hosts.txt' },

	// Ransomware
	{ url: '/forks/blocklistproject.ransomware.txt', file: 'ransomware/blocklistproject/ransomware.fork.txt' },

	// Cryptojacking
	{ url: '/forks/hoshsadiq.adblock-nocoin-list.txt', file: 'crypto/cryptojacking/hoshsadiq/adblock-nocoin-list.fork.txt' },
	{ url: '/forks/Snota418.Crypto-streams.txt', file: 'crypto/cryptojacking/Snota418/Crypto-streams.fork.txt' },
	{ url: '/forks/firebog.Prigent-Crypto.txt', file: 'crypto/cryptojacking/firebog/Prigent/Crypto.fork.txt' },

	// Abuse
	{ url: '/forks/abuse.urlhaus.txt', file: 'abuse/urlhaus.abuse.ch/hostfile.fork.txt' },
	{ url: '/malicious/blocklistproject.abuse.txt', file: 'abuse/blocklistproject/hosts.fork.txt' },

	// Fraud
	{ url: '/malicious/blocklistproject.fraud.txt', file: 'fraud/blocklistproject/hosts.fork.txt' },

	// Spam
	{ url: '/forks/RPiList.Spam-Mails.txt', file: 'spam/RPiList/spam-mails.fork.txt' },
	{ url: '/forks/stopforumspam.toxic_domains_whole.txt', file: 'spam/stopforumspam/toxic-domains-whole.fork.txt' },

	// Piracy
	{ url: '/forks/blocklistproject.piracy.txt', file: 'piracy/blocklistproject/piracy.fork.txt' },

	// Redirect
	{ url: '/forks/blocklistproject.redirect.txt', file: 'redirect/blocklistproject/redirect.fork.txt' },

	// Scam
	{ url: '/forks/blocklistproject.scam.txt', file: 'scam/blocklistproject/scam.fork.txt' },
	{ url: '/forks/Dogino.Discord-Phishing-URLs-scam.txt', file: 'scam/Dogino/Discord-Phishing-URLs-scam.fork.txt' },
	{ url: '/forks/durablenapkin.scamblocklist.txt', file: 'scam/durablenapkin/scamblocklist.fork.txt' },

	// Suspicious
	{ url: '/forks/firebog.w3kbl.txt', file: 'suspicious/firebog/w3kbl.fork.txt' },

	// Extension
	{ url: '/forks/justdomains.adguarddns.txt', file: 'ads/firebog/AdguardDNS.fork.txt' },
	{ url: '/forks/MajkiIT.adguard_host.txt', file: 'extensions/MajkiIT/adguard-host.fork.txt' },
	{ url: '/forks/MajkiIT.easy_privacy_host.txt', file: 'extensions/MajkiIT/easy-privacy-host.fork.txt' },
	{ url: '/forks/oisd.big.txt', file: 'extensions/oisd/big.fork.txt' },
	{ url: '/forks/r-a-y.AdguardApps.txt', file: 'extensions/r-a-y/AdguardApps.fork.txt' },
	{ url: '/forks/r-a-y.AdguardMobileSpyware.txt', file: 'extensions/r-a-y/AdguardMobileSpyware.fork.txt' },

	// StevenBlack Hosts
	{ url: '/forks/StevenBlack.hosts.txt', file: 'other/StevenBlack/hosts.fork.txt' },

	// Polish Filters
	{ url: '/forks/hole-cert.domains_hosts.txt', file: 'other/polish-blocklists/cert.pl/domains-hosts.fork.txt' },
	{ url: '/forks/MajkiIT.hostfile.txt', file: 'other/polish-blocklists/MajkiIT/hostfile.fork.txt' },
	{ url: '/forks/PolishFiltersTeam.KADhosts.txt', file: 'other/polish-blocklists/PolishFiltersTeam/KADhosts.fork.txt' },

	// Porn
	{ url: '/forks/blocklistproject.porn.txt', file: 'porn/blocklistproject/porn.fork.txt' },
	{ url: '/forks/oisd.nsfw.txt', file: 'porn/oisd/nsfw.fork.txt' },
	{ url: '/forks/Sinfonietta.pornography-hosts.txt', file: 'porn/Sinfonietta/pornography-hosts.fork.txt' },

	// Sefinek lists
	{ url: '/porn.txt', file: 'porn/sefinek.hosts.txt' },
	{ url: '/gambling.txt', file: 'gambling/sefinek.hosts.txt' },
	{ url: '/useless-websites.txt', file: 'useless-websites/sefinek.hosts.txt' },
	{ url: '/cryptocurrency.txt', file: 'crypto/sefinek.hosts.txt' },

	// Sites
	{ url: '/sites/youtube.txt', file: 'sites/youtube.txt' },
	{ url: '/sites/youtube-extended.txt', file: 'sites/youtube-extended.txt' },
	{ url: '/sites/pinterest.txt', file: 'sites/pinterest.txt' },
	{ url: '/sites/pixiv.txt', file: 'sites/anime.txt' },
	{ url: '/sites/omegle.txt', file: 'sites/ometv.txt' },
	{ url: '/sites/gamebanana.txt', file: 'sites/gamebanana.txt' },
	{ url: '/sites/booth.pm.txt', file: 'sites/anime.txt' },
	{ url: '/sites/patreon.txt', file: 'sites/patreon.txt' },

	// Social Media
	{ url: '/social/tiktok.txt', file: 'social/tiktok.txt' },
	{ url: '/social/facebook.txt', file: 'social/facebook.txt' },
	{ url: '/social/instagram.txt', file: 'social/instagram.txt' },
	{ url: '/social/snapchat.txt', file: 'social/snapchat.txt' },
	{ url: '/social/twitter.txt', file: 'social/x.txt' },

	// Apps
	{ url: '/apps/spotify.txt', file: 'apps/spotify.txt' },
	{ url: '/apps/discord.txt', file: 'apps/discord.txt' },
	{ url: '/apps/skype.txt', file: 'apps/skype.txt' },
	{ url: '/apps/whatsapp.txt', file: 'apps/whatsapp.txt' },

	// Games
	{ url: '/sites/riotgames.txt', file: 'sites/riotgames.txt' },
	{ url: '/games/league-of-legends.txt', file: 'games/league-of-legends.txt' },
	{ url: '/games/valorant.txt', file: 'games/valorant.txt' },
];

const REDIRECT_MAP = new Map();

for (const { url, file } of ROUTES) {
	for (const [key, { ext }] of Object.entries(BASE_DIRS)) {
		const resolved = ext ? file.replace(/\.txt$/, ext) : file;
		const target = `/generated/v1/${key}/${resolved}`;
		REDIRECT_MAP.set(`/generated/${key}${url}`, target);
		if (url !== `/${file}`) REDIRECT_MAP.set(`/generated/v1/${key}${url}`, target);
	}
}

const FMT = Object.keys(BASE_DIRS).map(k => k.replace(/\./g, '\\.')).join('|');

router.get(new RegExp(`^\\/generated\\/v1\\/(${FMT})(\\/.*)?$`), (req, res, next) => {
	const url = REDIRECT_MAP.get(req.path);
	if (!url) return next();
	res.redirect(301, url);
});

router.get(new RegExp(`^\\/generated\\/(${FMT})(\\/.*)?$`), (req, res) => {
	const url = REDIRECT_MAP.get(req.path);
	if (!url) return res.sendStatus(404);
	res.redirect(301, url);
});

router.REDIRECT_PATHS = new Set(REDIRECT_MAP.keys());

module.exports = router;