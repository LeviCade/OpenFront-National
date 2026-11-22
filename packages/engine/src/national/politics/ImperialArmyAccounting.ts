/** Exact arithmetic for separately owned hybrid imperial reserves. */
export interface ArmyCapacity {
  readonly id: string;
  readonly capacity: bigint;
  readonly active: bigint;
}

function checkedSlots(slots: readonly ArmyCapacity[]): ArmyCapacity[] {
  const sorted = [...slots].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(sorted.map(s => s.id)).size !== sorted.length ||
      sorted.some(s => !s.id || s.capacity < 0n || s.active < 0n))
    throw new Error("NATIONAL: invalid army capacity slots");
  return sorted;
}

function threshold(capacity: bigint, bps: number): bigint {
  if (capacity < 0n || !Number.isSafeInteger(bps) || bps < 0 || bps > 10_000)
    throw new Error("NATIONAL: invalid hybrid threshold");
  return capacity * BigInt(bps) / 10_000n;
}

export function hybridPoolCapacity(slots: readonly ArmyCapacity[], bps: number): bigint {
  threshold(0n, bps);
  return checkedSlots(slots).reduce((sum, s) => sum + s.capacity - threshold(s.capacity, bps), 0n);
}

export function splitHybridGrowth(gross: bigint, active: bigint, capacity: bigint,
  bps: number, pool: bigint, poolCapacity: bigint): { personal: bigint; imperial: bigint } {
  if (gross < 0n || active < 0n || pool < 0n || poolCapacity < 0n)
    throw new Error("NATIONAL: invalid hybrid growth");
  const target = threshold(capacity, bps);
  const personalRoom = active < target ? target - active : 0n;
  const above = gross > personalRoom ? gross - personalRoom : 0n;
  const poolRoom = pool < poolCapacity ? poolCapacity - pool : 0n;
  const imperial = above < poolRoom ? above : poolRoom;
  return { personal: gross - imperial, imperial };
}

/** Hamilton largest-remainder apportionment, exact ties by ascending ID. */
function proportional(total: bigint, slots: readonly ArmyCapacity[]): Map<string, bigint> {
  const credits = new Map<string, bigint>();
  if (total === 0n || slots.length === 0) return credits;
  let sum = slots.reduce((a,s) => a+s.capacity, 0n);
  const equal = sum === 0n;
  if (equal) sum = BigInt(slots.length);
  const rows = slots.map(s => {
    const numerator = total * (equal ? 1n : s.capacity);
    return { id: s.id, value: numerator / sum, remainder: numerator % sum };
  });
  let remaining = total - rows.reduce((a,r) => a+r.value, 0n);
  rows.sort((a,b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const row of rows) {
    if (remaining > 0n) { row.value++; remaining--; }
    if (row.value > 0n) credits.set(row.id,row.value);
  }
  return credits;
}

/** Allocate active troops weighted by actual cap, never exceed headroom.
 * If map contraction or returned deployments leave insufficient space,
 * preserve the residual as owned but inactive reserve claims. */
export function distributeImperialTroops(pool: bigint, slots: readonly ArmyCapacity[]): {
  active: Map<string, bigint>; deferred: Map<string, bigint>; unclaimed: bigint;
} {
  if (pool < 0n) throw new Error("NATIONAL: invalid imperial reserve");
  const sorted = checkedSlots(slots);
  const active = new Map<string, bigint>();
  if (sorted.length === 0) return { active, deferred: new Map(), unclaimed: pool };
  const room = new Map(sorted.map(s => [s.id, s.capacity > s.active ? s.capacity - s.active : 0n]));
  let available = [...room.values()].reduce((a,v)=>a+v,0n);
  let remaining = pool < available ? pool : available;
  const overflow = pool - remaining;
  while (remaining > 0n) {
    const eligible = sorted.filter(s => room.get(s.id)! > 0n);
    const shares = proportional(remaining,eligible);
    let spent = 0n;
    for (const s of eligible) {
      const share = shares.get(s.id) ?? 0n;
      const headroom = room.get(s.id)!;
      const amount = share < headroom ? share : headroom;
      if (amount === 0n) continue;
      active.set(s.id,(active.get(s.id) ?? 0n)+amount);
      room.set(s.id,headroom-amount);
      spent += amount;
    }
    if (spent === 0n) throw new Error("NATIONAL: non-progressing troop allocation");
    remaining -= spent;
  }
  // Return map ordering independent of slot ordering or apportionment rounds.
  const ordered = new Map([...active.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0));
  return { active: ordered, deferred: proportional(overflow, sorted), unclaimed: 0n };
}
