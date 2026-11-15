// The money: $800 to start, $300 a kill, $3250 for a round win, $1900 for a loss plus
// $500 for every loss in a row. A buy is only a number while the match says so.
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';

export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const ROUND_WIN = 3250;
export const ROUND_LOSS = 1900;
export const LOSS_STREAK_BONUS = 500;

export function createEconomy() {
  const state = {
    money: START_MONEY,
    lossStreak: 0,
    owned: { p9: true },
    grenades: { frag: 0, smoke: 0, flash: 0 },
    armor: false,
  };

  function priceOf(kind, id) {
    if (kind === 'weapon') return WEAPONS[id].price;
    if (kind === 'grenade') return GRENADES[id].price;
    return ARMOR_PRICE;
  }

  return {
    state,
    reset() {
      state.money = START_MONEY;
      state.lossStreak = 0;
      state.owned = { p9: true };
      state.grenades = { frag: 0, smoke: 0, flash: 0 };
      state.armor = false;
    },
    canAfford(kind, id) {
      return state.money >= priceOf(kind, id);
    },
    // Returns 'bought', 'owned' (already had it) or 'poor'.
    buy(kind, id) {
      if (kind === 'weapon' && state.owned[id]) return 'owned';
      if (kind === 'armor' && state.armor) return 'owned';
      const price = priceOf(kind, id);
      if (state.money < price) return 'poor';
      state.money -= price;
      if (kind === 'weapon') state.owned[id] = true;
      else if (kind === 'grenade') state.grenades[id] += 1;
      else state.armor = true;
      return 'bought';
    },
    addKill() {
      state.money += KILL_REWARD;
    },
    roundEnd(won) {
      if (won) {
        state.money += ROUND_WIN;
        state.lossStreak = 0;
      } else {
        state.money += ROUND_LOSS + state.lossStreak * LOSS_STREAK_BONUS;
        state.lossStreak += 1;
      }
    },
  };
}
