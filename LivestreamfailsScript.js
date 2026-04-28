//================ CONSTANTS ================//

const PLATFORM = "Livestreamfails";

const BASE_URL = "https://livestreamfails.com";

const URL_CLIPS = "https://api.livestreamfails.com/clips";
const URL_CLIP = "https://api.livestreamfails.com/clip";
const URL_STREAMER = "https://api.livestreamfails.com/streamer";

const URL_MEDIA_VIDEO = "https://media-prod.livestreamfails.com/video";
const URL_MEDIA_IMAGE = "https://media-prod.livestreamfails.com/image";

const WEB_CLIP_PREFIX = "https://livestreamfails.com/clip/";
const WEB_STREAMER_PREFIX = "https://livestreamfails.com/streamer/";

const RECOMMENDATIONS_LIMIT = 15;
const RATE_LIMIT_SLEEP_MS = 5000;
const DEFAULT_RETRIES = 2;
const API_PAGE_SIZE = 20;

const SORT_NEW = "new";
const SORT_TOP = "top";

const TIMEFRAME_ALL = "all";
const TIMEFRAME_DAY = "day";
const TIMEFRAME_WEEK = "week";
const TIMEFRAME_MONTH = "month";
const TIMEFRAME_YEAR = "year";

const FILTER_TIMEFRAME = "TIMEFRAME_FILTER";
const FILTER_NSFW = "NSFW_FILTER";

const ORDER_NEW_LABEL = "New";
const ORDER_TOP_LABEL = "Top";

const UNKNOWN_LABEL = "Unknown";

const TIMEFRAME_OPTIONS = [
    ["All time", TIMEFRAME_ALL],
    ["Today", TIMEFRAME_DAY],
    ["This week", TIMEFRAME_WEEK],
    ["This month", TIMEFRAME_MONTH],
    ["This year", TIMEFRAME_YEAR]
];

// Order must match LivestreamfailsConfig.json -> settings.minScoreIndex.options.
const MIN_SCORE_OPTIONS = [0, 100, 250, 500, 1000, 2500];

const IS_DESKTOP = bridge.buildPlatform === "desktop";

const USER_AGENT_FALLBACK = IS_DESKTOP
    ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.200 Safari/537.36"
    : "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.200 Mobile Safari/537.36";

const IMPERSONATION_TARGET = IS_DESKTOP ? "chrome136" : "chrome131_android";
const IS_IMPERSONATION_AVAILABLE = (typeof httpimp !== "undefined");

const REGEX_CLIP_URL = /^https?:\/\/(?:www\.)?livestreamfails\.com\/clip\/(\d+)/i;
const REGEX_STREAMER_URL = /^https?:\/\/(?:www\.)?livestreamfails\.com\/streamer\/(\d+)/i;

//================ STATE ================//

let _config = {};
let _settings = {};

const REQUEST_HEADERS = {
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": BASE_URL,
    "Referer": `${BASE_URL}/`
};

//================ SOURCE FUNCTIONS ================//

source.enable = function (conf, setts) {
    _config = conf ?? {};
    _settings = setts ?? {};

    if (IS_IMPERSONATION_AVAILABLE) {
        const httpImpClient = httpimp.getDefaultClient(true);
        if (httpImpClient.setDefaultImpersonateTarget) {
            httpImpClient.setDefaultImpersonateTarget(IMPERSONATION_TARGET);
        }
    }

    REQUEST_HEADERS["User-Agent"] = bridge.authUserAgent ?? bridge.captchaUserAgent ?? USER_AGENT_FALLBACK;
};

source.getHome = function () {
    return new ClipsPager({ querySort: SORT_NEW });
};

source.getSearchCapabilities = function () {
    return {
        types: [Type.Feed.Videos],
        sorts: [ORDER_NEW_LABEL, ORDER_TOP_LABEL],
        filters: [
            timeframeFilterGroup(),
            new FilterGroup("Include NSFW", [
                new FilterCapability("Include NSFW", "true", "true")
            ], false, FILTER_NSFW)
        ]
    };
};

source.search = function (query, type, order, filters) {
    const timeframe = filters?.[FILTER_TIMEFRAME]?.[0] ?? null;
    const includeNsfw = filters?.[FILTER_NSFW]?.[0] === "true";

    const params = {
        queryLabel: query,
        querySort: mapOrderToSort(order)
    };
    if (timeframe && timeframe !== TIMEFRAME_ALL) params.queryTimeframe = timeframe;
    if (!includeNsfw) params.queryIsNsfw = "false";

    return new ClipsPager(params);
};

source.isContentDetailsUrl = function (url) {
    return REGEX_CLIP_URL.test(url);
};

source.getContentDetails = function (url) {
    const clipId = parseUrlId(url, REGEX_CLIP_URL, "clip");
    const clip = httpGET({ url: `${URL_CLIP}/${clipId}` });
    return clipToPlatformVideoDetails(clip);
};

source.isChannelUrl = function (url) {
    return REGEX_STREAMER_URL.test(url);
};

source.getChannel = function (url) {
    const streamerId = parseUrlId(url, REGEX_STREAMER_URL, "streamer");
    const streamer = httpGET({ url: `${URL_STREAMER}/${streamerId}` });
    return streamerToPlatformChannel(streamer);
};

// Channel feeds use /streamer/{id}/clips. That endpoint honors querySort and
// queryMinScore but ignores queryPage and queryTimeframe — so we expose only
// sort, and return a single, non-paginated page. The /clips endpoint's
// queryStreamerId param is silently ignored, which is why we don't use it.
source.getChannelCapabilities = function () {
    return {
        types: [Type.Feed.Videos],
        sorts: [ORDER_NEW_LABEL, ORDER_TOP_LABEL]
    };
};

source.getChannelContents = function (url, type, order) {
    const streamerId = parseUrlId(url, REGEX_STREAMER_URL, "streamer");
    const clips = fetchClipArray(`${URL_STREAMER}/${streamerId}/clips`, { querySort: mapOrderToSort(order) });
    return new VideoPager(clipsToVideos(clips), false);
};

//================ HELPERS ================//

function getHttpClient() {
    return (IS_IMPERSONATION_AVAILABLE && _settings?.enableBrowserImpersonation)
        ? httpimp
        : http;
}

function timeframeFilterGroup() {
    return new FilterGroup(
        "Timeframe",
        TIMEFRAME_OPTIONS.map(([label, value]) => new FilterCapability(label, value, value)),
        false,
        FILTER_TIMEFRAME
    );
}

function mapOrderToSort(order) {
    return order === ORDER_TOP_LABEL ? SORT_TOP : SORT_NEW;
}

function parseUrlId(url, regex, kind) {
    const m = url.match(regex);
    if (!m) throw new ScriptException(`Not a ${kind} URL: ${url}`);
    return m[1];
}

function buildUrl(base, params) {
    const parts = [];
    for (const key of Object.keys(params)) {
        const v = params[key];
        if (v === null || v === undefined || v === "") continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
    return parts.length ? `${base}?${parts.join("&")}` : base;
}

function getMinScoreParam() {
    const idx = _settings?.minScoreIndex ?? 0;
    const value = MIN_SCORE_OPTIONS[idx] ?? 0;
    return value > 0 ? value : null;
}

function httpGET({ url, parseResponse = true, retries = DEFAULT_RETRIES, headers = {} }) {
    const client = getHttpClient();
    const mergedHeaders = { ...REQUEST_HEADERS, ...headers };
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        let resp;
        try {
            resp = client.GET(url, mergedHeaders, false);
        } catch (e) {
            lastError = e;
            continue;
        }

        throwIfCaptcha(resp);

        if (resp.code === 429) {
            log(`Rate limited on ${url} — waiting before retry`);
            lastError = new ScriptException(`Rate limited [429]: ${url}`);
            bridge.sleep(RATE_LIMIT_SLEEP_MS);
            continue;
        }

        if (resp.code >= 500) {
            log(`Server error ${resp.code} on ${url}`);
            lastError = new ScriptException(`Server error ${resp.code}: ${url}`);
            continue;
        }

        // 4xx (non-429) is permanent — don't waste retries on auth/not-found.
        if (!resp.isOk) {
            throw new ScriptException(`Request failed [${resp.code}]: ${url}`);
        }

        try {
            return parseResponse ? JSON.parse(resp.body) : resp.body;
        } catch (e) {
            lastError = e;
        }
    }

    log(`Request failed after ${retries + 1} attempt(s): ${url}`);
    throw lastError;
}

// Captcha challenges arrive as 403s with a Cloudflare-shaped HTML body.
function throwIfCaptcha(resp) {
    if (resp?.body && resp?.code === 403) {
        const body = resp.body.toLowerCase();
        if (body.includes("/cdn-cgi/challenge-platform") || body.includes("just a moment")) {
            throw new CaptchaRequiredException(resp.url, resp.body);
        }
    }
}

function getClipVideoUrl(clip) {
    if (clip?.videoId) return `${URL_MEDIA_VIDEO}/${clip.videoId}`;
    if (clip?.isLegacy && clip?.sourceLink && /\.mp4$/i.test(clip.sourceLink)) return clip.sourceLink;
    return null;
}

function mediaImageUrl(obj) {
    if (!obj?.imageId) return "";
    return `${URL_MEDIA_IMAGE}/${obj.imageId}`;
}

function thumbnailsFor(url) {
    return new Thumbnails(url ? [new Thumbnail(url, 0)] : []);
}

function streamerToAuthorLink(streamer) {
    if (!streamer || !streamer.id) {
        return new PlatformAuthorLink(
            new PlatformID(PLATFORM, "unknown", _config.id),
            UNKNOWN_LABEL,
            "",
            ""
        );
    }
    return new PlatformAuthorLink(
        new PlatformID(PLATFORM, String(streamer.id), _config.id),
        streamer.label ?? UNKNOWN_LABEL,
        `${WEB_STREAMER_PREFIX}${streamer.id}`,
        mediaImageUrl(streamer)
    );
}

function clipToPlatformVideo(clip) {
    return new PlatformVideo({
        id: new PlatformID(PLATFORM, String(clip.id), _config.id),
        name: clip.label ?? "",
        thumbnails: thumbnailsFor(mediaImageUrl(clip)),
        author: streamerToAuthorLink(clip.streamer),
        datetime: isoToUnixSeconds(clip.createdAt),
        duration: 0,
        viewCount: clip.redditScore ?? 0,
        url: `${WEB_CLIP_PREFIX}${clip.id}`,
        isLive: false
    });
}

function clipToPlatformVideoDetails(clip) {
    const videoUrl = getClipVideoUrl(clip);

    const sources = [];
    if (videoUrl) {
        sources.push(new VideoUrlSource({
            name: "MP4",
            url: videoUrl,
            width: 0,
            height: 0,
            duration: 0,
            container: "video/mp4"
        }));
    }

    const shareUrl = `${WEB_CLIP_PREFIX}${clip.id}`;
    const descParts = [];
    if (clip.category?.label) descParts.push(`Category: ${clip.category.label}`);
    if (clip.sourceLink) descParts.push(`Source: ${clip.sourceLink}`);
    if (typeof clip.redditScore === "number") descParts.push(`Reddit score: ${clip.redditScore}`);
    if (clip.isNSFW) descParts.push("NSFW");

    const details = new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, String(clip.id), _config.id),
        name: clip.label ?? "",
        thumbnails: thumbnailsFor(mediaImageUrl(clip)),
        author: streamerToAuthorLink(clip.streamer),
        datetime: isoToUnixSeconds(clip.createdAt),
        duration: 0,
        viewCount: clip.redditScore ?? 0,
        url: shareUrl,
        shareUrl,
        isLive: false,
        description: descParts.join("\n"),
        video: new VideoSourceDescriptor(sources)
    });

    details.getContentRecommendations = function () {
        return getContentRecommendationsForClip(clip);
    };

    return details;
}

function getContentRecommendationsForClip(clip) {
    if (!clip?.streamerId) {
        return new ClipsPager({ querySort: SORT_NEW });
    }

    const filtered = fetchClipArray(`${URL_STREAMER}/${clip.streamerId}/clips`, { querySort: SORT_NEW })
        .filter(c => c && c.id && c.id !== clip.id)
        .slice(0, RECOMMENDATIONS_LIMIT);

    return new ContentPager(clipsToVideos(filtered), false);
}

function streamerToPlatformChannel(streamer) {
    const links = {};
    if (streamer.sourceLink) {
        const platformName = streamer.sourcePlatform
            ? streamer.sourcePlatform.charAt(0).toUpperCase() + streamer.sourcePlatform.slice(1).toLowerCase()
            : "Source";
        links[platformName] = streamer.sourceLink;
    }

    return new PlatformChannel({
        id: new PlatformID(PLATFORM, String(streamer.id), _config.id),
        name: streamer.label ?? "",
        thumbnail: mediaImageUrl(streamer),
        banner: "",
        subscribers: 0,
        description: streamer.sourcePlatform ? `Streamer from ${streamer.sourcePlatform}` : "",
        url: `${WEB_STREAMER_PREFIX}${streamer.id}`,
        links
    });
}

function isoToUnixSeconds(iso) {
    if (!iso) return 0;
    const ms = Date.parse(iso);
    if (isNaN(ms)) return 0;
    return Math.floor(ms / 1000);
}

//================ PAGERS ================//

// hasMore uses the raw response length so a malformed clip dropped by
// clipsToVideos can't falsely signal end-of-feed.
class ClipsPager extends VideoPager {
    constructor(params) {
        const clips = fetchClipArray(URL_CLIPS, { ...params, queryPage: 0 });
        super(clipsToVideos(clips), clips.length >= API_PAGE_SIZE);
        this.params = params;
        this.page = 0;
    }

    nextPage() {
        this.page += 1;
        const clips = fetchClipArray(URL_CLIPS, { ...this.params, queryPage: this.page });
        this.results = clipsToVideos(clips);
        this.hasMore = clips.length >= API_PAGE_SIZE;
        return this;
    }
}

// Applies the user's minimum-score setting unless the caller already set it.
function fetchClipArray(baseUrl, params) {
    const minScore = getMinScoreParam();
    const finalParams = minScore !== null && params.queryMinScore === undefined
        ? { ...params, queryMinScore: minScore }
        : params;
    try {
        const clips = httpGET({ url: buildUrl(baseUrl, finalParams) });
        return Array.isArray(clips) ? clips : [];
    } catch (e) {
        log(`fetchClipArray failed [${baseUrl}]: ${e}`);
        return [];
    }
}

function clipsToVideos(clips) {
    return clips.filter(c => c && c.id).map(clipToPlatformVideo);
}

log("loaded");
