/**
 * Ticks between two warships of one order leaving the port. Mirrors
 * `AIRPORT_TAKEOFF_INTERVAL_TICKS`: a warship covers one tile per tick, so
 * five ticks keep the ships of one order visibly apart as a column instead of
 * stacking on the port tile in the same tick.
 */
export const WARSHIP_DEPARTURE_INTERVAL_TICKS = 5;
