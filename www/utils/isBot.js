const BOT_REGEX = /netcraftsurveyagent|domainsproject\.org|f(?:reepublicapis|acebook)|screaming frog|i(?:a_archiv|ndex)er|s(?:istrix|crapy|lurp)|scraper|(?:s(?:cann|pid)|fetch)er|lychee\/|crawl|yahoo|jest\/|bot/i;

module.exports = userAgent => BOT_REGEX.test(userAgent || '');
