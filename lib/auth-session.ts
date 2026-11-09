const DAY = 24 * 60 * 60;

// Keep rolling enabled: the SDK clamps expiry to the finite idle window, so
// Infinity never reaches the cookie. Each visit renews its 400-day lifetime.
export const AUTH_SESSION_CONFIG = {
  rolling: true,
  inactivityDuration: 400 * DAY,
  absoluteDuration: Number.POSITIVE_INFINITY,
  cookie: {
    transient: false,
    sameSite: "lax",
    path: "/",
  },
} as const;
