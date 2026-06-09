import { useMemo } from 'react';
import { useStore } from '../../stores/useStore';
import { Icon } from '../Icon';
import { EQUIPMENT } from '../../constants/equipmentLibrary';
import type { EquipmentItem } from '../../types';
import { summarizeCircuits, BREAKER_AMPS, NEC_DUTY } from '../../engine/power';
import { CABLE_SPECS, straightLineLengthFt } from '../../constants/cables';
import type { CableType } from '../../types';

interface Row {
  key: string;
  label: string;
  brand: string;
  category: string;
  qty: number;
  unitPrice: number;
  total: number;
}

function priceForItem(item: EquipmentItem): number {
  const t = EQUIPMENT.find(eq => eq.kind === item.kind && eq.label === item.label && (!item.brand || eq.brand === item.brand));
  return t?.price ?? 0;
}

const CATEGORY_LABEL: Record<string, string> = {
  'audio-speaker': 'Audio · Speakers',
  'audio-signal': 'Audio · Signal chain',
  'acoustic': 'Acoustic treatment',
  'video': 'Video',
  'lighting': 'Lighting',
  'infrastructure': 'Infrastructure',
  'reference': 'Reference points',
};

export function BomModal() {
  const open = useStore(s => s.openModal === 'bom');
  const setOpenModal = useStore(s => s.setOpenModal);
  const equipment = useStore(s => s.equipment);
  const connections = useStore(s => s.connections);
  const meta = useStore(s => s.meta);

  // Group identical items (same brand+label+kind) and sum quantity.
  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>();
    for (const item of equipment) {
      if (item.category === 'reference') continue;
      const key = `${item.kind}|${item.brand ?? ''}|${item.label}`;
      const unit = priceForItem(item);
      const existing = map.get(key);
      if (existing) {
        existing.qty += 1;
        existing.total += unit;
      } else {
        map.set(key, {
          key, label: item.label, brand: item.brand ?? 'Custom',
          category: item.category, qty: 1, unitPrice: unit, total: unit,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.label.localeCompare(b.label);
    });
  }, [equipment]);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const subtotalsByCat = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] ?? 0) + r.total;
    return acc;
  }, {});

  if (!open) return null;

  // Group rows by category for display
  const groups: Record<string, Row[]> = {};
  for (const r of rows) (groups[r.category] = groups[r.category] || []).push(r);

  return (
    <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 880 }}>
        <div className="modal-header">
          <div>
            <h2>Bill of Materials</h2>
            <div className="sub">{meta.name} · {rows.reduce((s, r) => s + r.qty, 0)} items · {Object.keys(groups).length} categories</div>
          </div>
          <button className="icon-close" onClick={() => setOpenModal(null)}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          {rows.length === 0 ? (
            <div className="inspector-empty">
              <div className="icon-bubble"><Icon name="bag" size={24}/></div>
              <p>No equipment placed yet — add items from the catalog and they'll appear here.</p>
            </div>
          ) : (
            <>
              {Object.entries(groups).map(([cat, list]) => (
                <div key={cat} style={{ marginBottom: 18 }}>
                  <div style={{
                    fontFamily: 'Montserrat', fontWeight: 700, fontSize: 11,
                    letterSpacing: '0.14em', textTransform: 'uppercase',
                    color: 'var(--royal-blue)', marginBottom: 6,
                  }}>{CATEGORY_LABEL[cat] ?? cat}</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: 'var(--fg2)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <th style={tdHead}>Brand</th>
                        <th style={tdHead}>Model</th>
                        <th style={{ ...tdHead, textAlign: 'right' }}>Qty</th>
                        <th style={{ ...tdHead, textAlign: 'right' }}>Unit</th>
                        <th style={{ ...tdHead, textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map(r => (
                        <tr key={r.key} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={td}>{r.brand}</td>
                          <td style={td}>{r.label}</td>
                          <td style={{ ...td, textAlign: 'right' }} className="tabular">{r.qty}</td>
                          <td style={{ ...td, textAlign: 'right' }} className="tabular">
                            {r.unitPrice ? `$${r.unitPrice.toLocaleString()}` : '—'}
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} className="tabular">
                            {r.total ? `$${r.total.toLocaleString()}` : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={td} colSpan={4} className="muted">Subtotal · {CATEGORY_LABEL[cat] ?? cat}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} className="tabular">
                          {subtotalsByCat[cat] ? `$${subtotalsByCat[cat].toLocaleString()}` : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}

              <div style={{
                marginTop: 10, padding: '14px 16px',
                background: 'var(--bg-alt)', borderRadius: 'var(--radius-md)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              }}>
                <div>
                  <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.10em' }}>Estimated equipment subtotal</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    Excludes labor, rigging, cabling, freight, and any sales tax. List prices only.
                  </div>
                </div>
                <strong style={{ fontFamily: 'Montserrat', fontSize: 22 }} className="tabular">
                  ${grandTotal.toLocaleString()}
                </strong>
              </div>

              <PowerSummary equipment={equipment}/>
              <CablingSummary equipment={equipment} connections={connections}/>
              <TrussSummary equipment={equipment}/>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setOpenModal(null)}>Close</button>
          <button className="btn btn-secondary" onClick={() => { setOpenModal('export'); }}>
            <Icon name="download" size={14}/> Export
          </button>
        </div>
      </div>
    </div>
  );
}

const td: React.CSSProperties = { padding: '8px 8px', verticalAlign: 'top' };
const tdHead: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', fontWeight: 600 };

function TrussSummary({ equipment }: { equipment: EquipmentItem[] }) {
  const trusses = equipment.filter(e =>
    e.kind === 'truss-straight' || e.kind === 'truss-square' || e.kind === 'truss-circle');
  if (trusses.length === 0) return null;

  const lengthOf = (t: EquipmentItem): number => {
    if (t.kind === 'truss-straight') return t.trussLengthFt ?? 10;
    if (t.kind === 'truss-square') return 2 * ((t.trussWidthFt ?? 16) + (t.trussDepthFt ?? 16));
    if (t.kind === 'truss-circle') return Math.PI * (t.trussDiameterFt ?? 12);
    return 0;
  };

  // Group identical (kind+brand+label) and sum length so a 4× quantity row makes sense.
  const groups = new Map<string, { brand: string; label: string; kind: string; qty: number; ft: number; price: number }>();
  for (const t of trusses) {
    const key = `${t.kind}|${t.brand ?? ''}|${t.label}`;
    const tpl = EQUIPMENT.find(eq => eq.kind === t.kind && eq.label === t.label && (!t.brand || eq.brand === t.brand));
    const price = tpl?.price ?? 0;
    const g = groups.get(key) ?? { brand: t.brand ?? 'Custom', label: t.label, kind: t.kind, qty: 0, ft: 0, price: 0 };
    g.qty += 1;
    g.ft += lengthOf(t);
    g.price += price;
    groups.set(key, g);
  }

  const rows = Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  const totalFt = rows.reduce((s, r) => s + r.ft, 0);
  const totalPrice = rows.reduce((s, r) => s + r.price, 0);

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{
        fontFamily: 'Montserrat', fontWeight: 700, fontSize: 11,
        letterSpacing: '0.14em', textTransform: 'uppercase',
        color: 'var(--royal-blue)', marginBottom: 6,
      }}>Trusses & Rigging</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ color: 'var(--fg2)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <th style={tdHead}>Brand</th>
            <th style={tdHead}>Model</th>
            <th style={{ ...tdHead, textAlign: 'right' }}>Qty</th>
            <th style={{ ...tdHead, textAlign: 'right' }}>Total ft</th>
            <th style={{ ...tdHead, textAlign: 'right' }}>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.kind + r.label} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={td}>{r.brand}</td>
              <td style={td}>{r.label}</td>
              <td style={{ ...td, textAlign: 'right' }} className="tabular">{r.qty}</td>
              <td style={{ ...td, textAlign: 'right' }} className="tabular">{r.ft.toFixed(0)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} className="tabular">
                {r.price ? `$${r.price.toLocaleString()}` : '—'}
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid var(--border)' }}>
            <td style={td} colSpan={3} className="muted"><strong>Truss subtotal</strong></td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} className="tabular">{totalFt.toFixed(0)}</td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} className="tabular">
              {totalPrice ? `$${totalPrice.toLocaleString()}` : '—'}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CablingSummary({ equipment, connections }: { equipment: EquipmentItem[]; connections: import('../../types').Connection[] }) {
  if (connections.length === 0) return null;
  type Bucket = { count: number; ft: number; cost: number; warned: number };
  const totals: Record<string, Bucket> = {};
  for (const c of connections) {
    const a = equipment.find(e => e.id === c.fromId);
    const b = equipment.find(e => e.id === c.toId);
    const spec = CABLE_SPECS[c.cableType];
    if (!a || !b || !spec) continue;
    const ft = typeof c.lengthOverride === 'number' ? c.lengthOverride : straightLineLengthFt(a, b);
    const t = totals[c.cableType] ??= { count: 0, ft: 0, cost: 0, warned: 0 };
    t.count++; t.ft += ft;
    t.cost += ft * spec.costPerFt;
    if (ft > spec.maxLengthFt) t.warned++;
  }
  const types = Object.keys(totals).sort();
  const grand = types.reduce((s, k) => s + totals[k].cost, 0);
  const totalFt = types.reduce((s, k) => s + totals[k].ft, 0);

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{
        fontFamily: 'Montserrat', fontWeight: 700, fontSize: 11,
        letterSpacing: '0.14em', textTransform: 'uppercase',
        color: 'var(--royal-blue)', marginBottom: 6,
      }}>Cabling</div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
        Lengths use a 20% slack factor over straight-line distance. Costs are list-price estimates.
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ color: 'var(--fg2)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <th style={tdHead}>Cable type</th>
            <th style={{ ...tdHead, textAlign: 'right' }}>Runs</th>
            <th style={{ ...tdHead, textAlign: 'right' }}>Length</th>
            <th style={{ ...tdHead, textAlign: 'right' }}>$/ft</th>
            <th style={{ ...tdHead, textAlign: 'right' }}>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {types.map(t => {
            const spec = CABLE_SPECS[t as CableType];
            const b = totals[t];
            return (
              <tr key={t} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={td}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999,
                    background: spec.color, marginRight: 8 }}/>
                  {spec.longLabel}
                  {b.warned > 0 && (
                    <span style={{ color: '#A52A2A', marginLeft: 8, fontSize: 11 }}>
                      ⚠ {b.warned} long
                    </span>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right' }} className="tabular">{b.count}</td>
                <td style={{ ...td, textAlign: 'right' }} className="tabular">{b.ft.toFixed(0)} ft</td>
                <td style={{ ...td, textAlign: 'right' }} className="tabular">${spec.costPerFt.toFixed(2)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} className="tabular">${b.cost.toFixed(0)}</td>
              </tr>
            );
          })}
          <tr style={{ borderTop: '1px solid var(--border)' }}>
            <td style={td} colSpan={2} className="muted"><strong>Cabling total</strong></td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} className="tabular">{totalFt.toFixed(0)} ft</td>
            <td style={td}/>
            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} className="tabular">${grand.toFixed(0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PowerSummary({ equipment }: { equipment: EquipmentItem[] }) {
  const { circuits, totalWatts, totalAmps } = summarizeCircuits(equipment);
  if (circuits.length === 0) return null;
  const overloaded = circuits.filter(c => c.overloaded);
  const continuousLimit = BREAKER_AMPS * NEC_DUTY;

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{
        fontFamily: 'Montserrat', fontWeight: 700, fontSize: 11,
        letterSpacing: '0.14em', textTransform: 'uppercase',
        color: 'var(--royal-blue)', marginBottom: 6,
      }}>Power & Circuits</div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
        {BREAKER_AMPS} A branch circuits at 120 V · NEC continuous-load limit {continuousLimit.toFixed(0)} A
        {overloaded.length > 0 && (
          <strong style={{ color: '#C53030', marginLeft: 8 }}>
            · {overloaded.length} circuit{overloaded.length === 1 ? '' : 's'} overloaded
          </strong>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ color: 'var(--fg2)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <th style={tdHead}>Circuit</th>
            <th style={{ ...tdHead, textAlign: 'right' }}>Items</th>
            <th style={{ ...tdHead, textAlign: 'right' }}>Watts</th>
            <th style={{ ...tdHead, textAlign: 'right' }}>Amps</th>
            <th style={{ ...tdHead, textAlign: 'right' }}>% of safe</th>
          </tr>
        </thead>
        <tbody>
          {circuits.map(c => {
            const color = c.overloaded ? '#C53030' : c.warning ? '#F5A623' : 'var(--fg1)';
            return (
              <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ ...td, fontStyle: c.id === '__unassigned' ? 'italic' : 'normal' }}>{c.name}</td>
                <td style={{ ...td, textAlign: 'right' }} className="tabular">{c.items.length}</td>
                <td style={{ ...td, textAlign: 'right' }} className="tabular">{c.watts.toFixed(0)}</td>
                <td style={{ ...td, textAlign: 'right', color, fontWeight: 600 }} className="tabular">{c.amps.toFixed(2)}</td>
                <td style={{ ...td, textAlign: 'right', color }} className="tabular">{(c.pctOfBreaker * 100).toFixed(0)}%</td>
              </tr>
            );
          })}
          <tr style={{ borderTop: '1px solid var(--border)' }}>
            <td style={td} colSpan={2} className="muted"><strong>System total</strong></td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} className="tabular">{totalWatts.toFixed(0)}</td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} className="tabular">{totalAmps.toFixed(2)}</td>
            <td style={td}/>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
