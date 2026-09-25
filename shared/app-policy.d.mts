/** Types for the application-origin security policy. */

export interface AppPolicyOptions {
  /** The Palm OS origin permitted to frame this application. */
  osOrigin?: string;
  /** Whether the application may reach the network at all. */
  allowNetwork?: boolean;
}

export declare function appContentSecurityPolicy(options?: AppPolicyOptions): string;

export declare function appSecurityHeaders(options?: AppPolicyOptions): Record<string, string>;

export declare function osContentSecurityPolicy(): string;

export declare function osSecurityHeaders(options?: { dev?: boolean }): Record<string, string>;
