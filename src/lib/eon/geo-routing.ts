import { readFileSync } from "node:fs";
import path from "node:path";
import { lookupCategories, lookupCountry, parseGeoIpList, parseGeoSiteList, type GeoIpList, type GeoSiteList } from "./geo.ts";
import { geoDataDir } from "./geo-settings.ts";

/**
 * Cyber geo routing. Off unless INFINITUM_GEO_ENABLED is explicitly on.
 * While it is off, policy, annotation and logging add nothing.
 */

export interface GeoHint {
  ip?: string;
  domain?: string;
}

export interface GeoNote {
  country: string | null;
  categories: string[];
  /** One line for the ledger, written only when routing is on and a hint was supplied. */
  note: string;
}

export interface GeoRouting {
  readonly enabled: boolean;
  /** Extra refusal, or null to leave the existing decision alone. */
  policy(hint: GeoHint): string | null;
  /** Annotation for a ledger payload, or null when there is nothing to add. */
  annotate(hint: GeoHint): GeoNote | null;
  /** The same line as the annotation note, or null when annotate would add nothing. */
  log(hint: GeoHint): string | null;
}

export interface GeoPolicyLists {
  refuseCountries?: readonly string[];
  refuseCategories?: readonly string[];
}

const NONE: GeoPolicyLists = {};

export const DISABLED_GEO: GeoRouting = Object.freeze({
  enabled: false,
  policy: () => null,
  annotate: () => null,
  log: () => null,
});

/** True only for an explicit on. Unset, empty, and anything else stay off. */
export function infinitumGeoEnabled(value: string | undefined): boolean {
  if (value == null) return false;
  return ["1", "true", "on", "yes"].includes(value.trim().toLowerCase());
}

function sets(options: GeoPolicyLists) {
  return {
    countries: new Set((options.refuseCountries ?? []).map((c) => c.toLowerCase())),
    categories: new Set((options.refuseCategories ?? []).map((c) => c.toLowerCase())),
  };
}

function view(ip: GeoIpList, site: GeoSiteList, hint: GeoHint) {
  return {
    country: hint.ip ? lookupCountry(ip, hint.ip) : null,
    categories: hint.domain ? lookupCategories(site, hint.domain) : [],
  };
}

function noteOf(hint: GeoHint, country: string | null, categories: string[]): string {
  const where = [hint.ip, hint.domain].filter(Boolean).join(" ");
  const lists = categories.length ? categories.join(", ") : "none";
  return `cyber geo ${where}: country ${country ?? "unknown"}, categories ${lists}`;
}

function fromLists(ip: GeoIpList, site: GeoSiteList, options: GeoPolicyLists): GeoRouting {
  const policy = sets(options);
  const seen = (hint: GeoHint) => {
    if (!hint.ip && !hint.domain) return null;
    const found = view(ip, site, hint);
    return { ...found, note: noteOf(hint, found.country, found.categories) };
  };
  return {
    enabled: true,
    policy(hint) {
      const found = seen(hint);
      if (!found) return null;
      if (found.country && policy.countries.has(found.country.toLowerCase())) {
        return `Cyber geo routing refused ${hint.ip}: country ${found.country}.`;
      }
      const category = found.categories.find((c) => policy.categories.has(c.toLowerCase()));
      if (category) return `Cyber geo routing refused ${hint.domain}: category ${category}.`;
      return null;
    },
    annotate: seen,
    log(hint) {
      return seen(hint)?.note ?? null;
    },
  };
}

/** Router over lists already in memory. Used by tests and by the file loader. */
export function geoRoutingFromLists(ip: GeoIpList, site: GeoSiteList, options: GeoPolicyLists = NONE): GeoRouting {
  return fromLists(ip, site, options);
}

/**
 * Router that reads data/geo/geoip.dat and geosite.dat the first time a hint arrives.
 * A missing or unreadable file leaves lookups empty rather than failing the exercise.
 */
export function openGeoRouting(dir = geoDataDir(), options: GeoPolicyLists = NONE): GeoRouting {
  let loaded: GeoRouting | null | undefined;
  const inner = (): GeoRouting | null => {
    if (loaded !== undefined) return loaded;
    try {
      const ip = parseGeoIpList(readFileSync(path.join(dir, "geoip.dat")));
      const site = parseGeoSiteList(readFileSync(path.join(dir, "geosite.dat")));
      loaded = fromLists(ip, site, options);
    } catch {
      loaded = null;
    }
    return loaded;
  };
  return {
    enabled: true,
    policy(hint) {
      return inner()?.policy(hint) ?? null;
    },
    annotate(hint) {
      if (!hint.ip && !hint.domain) return null;
      return inner()?.annotate(hint) ?? null;
    },
    log(hint) {
      if (!hint.ip && !hint.domain) return null;
      return inner()?.log(hint) ?? null;
    },
  };
}

/** The process gate. Anything other than an explicit on is the disabled router. */
export function geoRoutingFromEnv(value: string | undefined, dir = geoDataDir(), options: GeoPolicyLists = NONE): GeoRouting {
  if (!infinitumGeoEnabled(value)) return DISABLED_GEO;
  return openGeoRouting(dir, options);
}
