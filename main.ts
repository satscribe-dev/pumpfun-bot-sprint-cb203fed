// Pump.fun Bot Sprint — momentum breakout bot (paper trading, replay v2).
//
// Idea, from first principles: on pump.fun most new coins die within minutes
// and a few run far. So buy a coin only while it is young and its early flow
// is buy-dominated and already rising, then let a wide take-profit catch the
// runners while a tight stop-loss, a trailing stop and a time exit cut the
// losers. Every rule below is a plain constant — no per-coin memory, no
// clock, no randomness — so the bot is deterministic and generalises to
// coins it has never seen.
//
// Fee math that sets the numbers: one trade costs 95 + 30 bps of curve fees
// plus 5,000 + 100,000 lamports of tx fees, so a 0.05 SOL round trip costs
// about 2.7% of size. A +35% take-profit against a -12% stop-loss needs
// roughly a 1-in-4 win rate to break even, before the trailing stop lets
// runners pay for the losers.
//
// Written from scratch in this session for the
// u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed bounty.

import { runBot } from "./vendor/makefun-bot.ts";
import type { Batch, BotState, OrderInput } from "./vendor/makefun-bot.ts";

// ------------------------------------------------------------------ tuning

/** SOL spent per entry (0.05 SOL). */
const BUY_SIZE_LAMPORTS = 50_000_000n;
/** Smallest buy worth sending (0.02 SOL): below this the fixed tx fee eats the edge. */
const MIN_BUY_LAMPORTS = 20_000_000n;
/** Only coins this young (in trades seen) may be entered. */
const MAX_ENTRY_TRADES = 40;
/** Entry needs price up at least +8% off its first print (bps). */
const ENTRY_RISE_BPS = 800;
/** Never chase a coin already up +80% off its first print (bps). */
const ENTRY_MAX_RISE_BPS = 8000;
/** Entry needs at least this many buy trades seen. */
const ENTRY_MIN_BUYS = 5;
/** Entry needs buys to be at least 70% of volume seen (bps). */
const ENTRY_MIN_BUY_SHARE_BPS = 7000;
/** Take profit: sell at +35% off the entry price (bps). */
const TAKE_PROFIT_BPS = 3500;
/** Stop loss: sell at -12% off the entry price (bps). */
const STOP_LOSS_BPS = 1200;
/** Trailing stop arms once the coin is +15% off entry (bps). */
const TRAIL_ARM_BPS = 1500;
/** Trailing stop: sell 20% below the peak since entry (bps). */
const TRAIL_DROP_BPS = 2000;
/** Longest hold, in slots (~0.4 s each, so ~10 minutes). */
const MAX_HOLD_SLOTS = 1500;
/** Slippage tolerance on every order (5%). */
const MAX_SLIPPAGE_BPS = 500;
/** Harness cap on open positions (mirrors hello.caps). */
const MAX_POSITIONS = 5;

// ------------------------------------------------------------------ state

interface CoinState {
  firstPrice: number;
  trades: number;
  buys: number;
  buyVol: bigint;
  sellVol: bigint;
  complete: boolean;
}

interface EntryState {
  entryPrice: number;
  entrySlot: number;
  peak: number;
}

/** Per-mint flow stats, first-seen order. */
const coins = new Map<string, CoinState>();
/** Entry facts for mints we bought (or tried to buy). */
const entries = new Map<string, EntryState>();
/** Mints whose buy filled: never enter the same coin twice. */
const traded = new Set<string>();

function priceOf(state: BotState, mint: string): number {
  const curve = state.curves.get(mint);
  if (curve === undefined) return 0;
  const tok = curve.virtual_token_reserves;
  const quo = curve.virtual_quote_reserves;
  if (tok <= 0n || quo <= 0n) return 0;
  return Number(quo) / Number(tok);
}

function hasPendingBuy(state: BotState, mint: string): boolean {
  for (const p of state.pending.values()) {
    if (p.order.side === "buy" && p.order.mint === mint) return true;
  }
  return false;
}

function hasPendingSell(state: BotState, mint: string): boolean {
  for (const p of state.pending.values()) {
    if (p.order.side === "sell" && p.order.mint === mint) return true;
  }
  return false;
}

function onBatch(state: BotState, batch: Batch): OrderInput[] {
  const orders: OrderInput[] = [];
  const touched = new Set<string>();

  // 1. Fold this batch's fills in: a filled buy marks the mint as traded.
  for (const fill of batch.fills) {
    if (fill.side === "buy" && fill.status === "filled") traded.add(fill.mint);
  }

  // 2. Update per-coin flow stats from this batch's events.
  for (const event of batch.events) {
    const mint = event.mint;
    touched.add(mint);
    let coin = coins.get(mint);
    if (coin === undefined) {
      coin = { firstPrice: 0, trades: 0, buys: 0, buyVol: 0n, sellVol: 0n, complete: false };
      coins.set(mint, coin);
    }
    if (event.event === "CreateEvent") {
      const tok = BigInt(event.virtual_token_reserves);
      const quo = BigInt(event.virtual_quote_reserves);
      if (tok > 0n && quo > 0n) coin.firstPrice = Number(quo) / Number(tok);
    } else if (event.event === "TradeEvent") {
      const tok = BigInt(event.virtual_token_reserves);
      const quo = BigInt(event.virtual_quote_reserves);
      if (coin.firstPrice === 0 && tok > 0n && quo > 0n) {
        coin.firstPrice = Number(quo) / Number(tok);
      }
      coin.trades += 1;
      const amount = BigInt(event.sol_amount);
      if (event.is_buy) {
        coin.buys += 1;
        coin.buyVol += amount;
      } else {
        coin.sellVol += amount;
      }
    } else {
      // CompleteEvent: the curve is done; the harness closes any position.
      coin.complete = true;
    }
  }

  // 3. Drop entry records for positions that are gone with no buy pending
  // (buy rejected/failed, or sell filled).
  for (const mint of [...entries.keys()]) {
    if (!state.positions.has(mint) && !hasPendingBuy(state, mint)) entries.delete(mint);
  }

  // 4. Exits: check every open position against take-profit, stop-loss,
  // trailing stop and the time exit. Sell the whole position when one fires.
  for (const [mint, pos] of state.positions) {
    if (hasPendingSell(state, mint)) continue;
    const price = priceOf(state, mint);
    if (price <= 0) continue;
    const entry = entries.get(mint);
    // Fall back to the average cost basis when we have no entry record.
    const entryPrice =
      entry !== undefined
        ? entry.entryPrice
        : Number(pos.cost_lamports) / Number(pos.token_amount);
    if (entryPrice <= 0) continue;
    if (entry !== undefined && price > entry.peak) entry.peak = price;
    const peak = entry !== undefined ? entry.peak : price;
    const entrySlot = entry !== undefined ? entry.entrySlot : batch.slot;
    const up = price >= entryPrice * (1 + TAKE_PROFIT_BPS / 10_000);
    const down = price <= entryPrice * (1 - STOP_LOSS_BPS / 10_000);
    const trailing =
      peak >= entryPrice * (1 + TRAIL_ARM_BPS / 10_000) &&
      price <= peak * (1 - TRAIL_DROP_BPS / 10_000);
    const stale = batch.slot - entrySlot >= MAX_HOLD_SLOTS;
    if (up || down || trailing || stale) {
      orders.push({
        side: "sell",
        mint,
        token_amount: pos.token_amount,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      });
    }
  }

  // 5. Entries: one per mint, only young coins with buy-dominated rising flow.
  if (state.committedPositionCount() < MAX_POSITIONS) {
    const txFee = state.txFeeLamports();
    for (const mint of touched) {
      if (orders.length >= 16) break;
      if (state.committedPositionCount() >= MAX_POSITIONS) break;
      if (traded.has(mint)) continue;
      if (state.positions.has(mint)) continue;
      if (hasPendingBuy(state, mint)) continue;
      const coin = coins.get(mint);
      if (coin === undefined || coin.complete) continue;
      if (coin.firstPrice <= 0) continue;
      if (coin.trades > MAX_ENTRY_TRADES) continue;
      if (coin.buys < ENTRY_MIN_BUYS) continue;
      const volume = coin.buyVol + coin.sellVol;
      if (volume <= 0n) continue;
      if ((coin.buyVol * 10_000n) / volume < BigInt(ENTRY_MIN_BUY_SHARE_BPS)) continue;
      const price = priceOf(state, mint);
      if (price <= 0) continue;
      if (price < coin.firstPrice * (1 + ENTRY_RISE_BPS / 10_000)) continue;
      if (price > coin.firstPrice * (1 + ENTRY_MAX_RISE_BPS / 10_000)) continue;
      let size = BUY_SIZE_LAMPORTS;
      const cap = state.maxBuyLamports(mint);
      if (cap < size) size = cap;
      if (size < MIN_BUY_LAMPORTS) continue;
      if (state.freeCashLamports() < size + txFee) continue;
      orders.push({
        side: "buy",
        mint,
        quote_lamports: size,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      });
      entries.set(mint, { entryPrice: price, entrySlot: batch.slot, peak: price });
    }
  }

  return orders;
}

await runBot({ onBatch });
