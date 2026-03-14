export function createNormalizedMarket({
  matchId,
  marketType,
  period = "full_time",
  line = null,
  selection,
  side = null,
  scope = "match",
  teamName = null,
  playerName = null,
  bookmaker = null,
  odd = null,
  rawMarketName = null,
  rawSelectionName = null,
  source = null,
  metadata = {}
}) {
  return {
    matchId: matchId || null,
    marketType: marketType || null,
    period,
    line,
    selection: selection || null,
    side,
    scope,
    teamName,
    playerName,
    bookmaker,
    odd,
    rawMarketName,
    rawSelectionName,
    source,
    metadata
  };
}

