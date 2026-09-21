/** Types for the origin algebra shared by the server and the browser. */

export declare const APP_ID_PATTERN: RegExp;

export declare function isValidAppId(id: unknown): id is string;

export declare function splitHost(
  host: string | undefined | null,
): { hostname: string; port: string } | null;

export declare function supportsAppOrigins(hostname: string | undefined | null): boolean;

export declare function appIdFromHost(host: string | undefined | null): string | null;

export declare function baseHostFrom(host: string | undefined | null): string | null;

export declare function appOriginFor(
  appId: string,
  location: { protocol: string; host: string },
): string | null;
