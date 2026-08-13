/**
 * Core drawing logic — review subset.
 * Single-point annotations only (entry/exit levels, trade-time markers),
 * fixed default style: no overrides, no free text, no two-point shapes.
 * NOTE: drawings can persist into the saved TradingView layout — callers
 * should work on a scratch layout and clearAll() after screenshots.
 */
import { evaluate as _evaluate, getChartApi as _getChartApi, safeString, requireFinite } from '../connection.js';

function _resolve(deps) {
  return { evaluate: deps?.evaluate || _evaluate, getChartApi: deps?.getChartApi || _getChartApi };
}

export const SHAPES = ['horizontal_line', 'vertical_line'];

export async function drawShape({ shape, point, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  if (!SHAPES.includes(shape)) {
    throw new Error(`shape must be one of: ${SHAPES.join(', ')}`);
  }
  const p1time = requireFinite(point.time, 'point.time');
  const p1price = requireFinite(point.price, 'point.price');
  const apiPath = await getChartApi();

  const before = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);

  await evaluate(`
    ${apiPath}.createShape(
      { time: ${p1time}, price: ${p1price} },
      { shape: ${safeString(shape)}, overrides: {} }
    )
  `);

  await new Promise(r => setTimeout(r, 200));
  const after = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);
  const newId = (after || []).find(id => !(before || []).includes(id)) || null;
  return { success: true, shape, entity_id: newId };
}

export async function clearAll({ _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  await evaluate(`${apiPath}.removeAllShapes()`);
  return { success: true, action: 'all_shapes_removed' };
}
