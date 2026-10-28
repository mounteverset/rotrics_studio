import { upgradeLayout, validateProject, artworkBounds, textBounds } from './project.js';

export const layoutObjects = (project) => [...(project.artworks || []), ...(project.texts || [])];
export const objectBounds = (project, object) => object.writing ? textBounds(object, project.origin, project.fonts) : artworkBounds(object, project.origin);
export function selectionIds(project, ids) {
  const objects = layoutObjects(project);
  const selected = new Set(ids);
  const groups = new Set(objects.filter((object) => selected.has(object.id) && object.group).map((object) => object.group));
  return objects.filter((object) => selected.has(object.id) || (object.group && groups.has(object.group))).map((object) => object.id);
}
export function combinedBounds(bounds) {
  if (!bounds.length) throw new Error('Select at least one object');
  return { left: Math.min(...bounds.map((b) => b.left)), right: Math.max(...bounds.map((b) => b.right)),
    bottom: Math.min(...bounds.map((b) => b.bottom)), top: Math.max(...bounds.map((b) => b.top)) };
}
export function layoutAction(value, ids, action) {
  const project = upgradeLayout(value);
  const selected = new Set(selectionIds(project, ids));
  if (!selected.size) throw new Error('Select at least one object');
  const objects = layoutObjects(project).filter((object) => selected.has(object.id));
  const updates = new Map();
  let selection = [...selected];
  if (action.type === 'move') {
    if (![action.dx, action.dy].every(Number.isFinite)) throw new Error('Invalid movement');
    for (const object of objects) updates.set(object.id, { ...object, x: object.x + action.dx, y: object.y + action.dy });
  } else if (action.type === 'group' || action.type === 'ungroup') {
    if (action.type === 'group' && objects.length < 2) throw new Error('Select two or more objects to group');
    const group = crypto.randomUUID();
    for (const object of objects) {
      const copy = { ...object }; delete copy.group;
      if (action.type === 'group') copy.group = group;
      updates.set(object.id, copy);
    }
  } else if (action.type === 'align') {
    if (!['x', 'y'].includes(action.axis) || !['min', 'center', 'max'].includes(action.edge)) throw new Error('Choose an alignment');
    const units = new Map();
    for (const object of objects) {
      const key = object.group ? `group:${object.group}` : `object:${object.id}`;
      if (!units.has(key)) units.set(key, []);
      units.get(key).push(object);
    }
    const entries = [...units.values()].map((members) => ({ members, bounds: combinedBounds(members.map((object) => objectBounds(project, object))) }));
    const total = combinedBounds(entries.map((entry) => entry.bounds));
    const coordinate = (bounds) => action.axis === 'x'
      ? action.edge === 'min' ? bounds.left : action.edge === 'max' ? bounds.right : (bounds.left + bounds.right) / 2
      : action.edge === 'min' ? bounds.bottom : action.edge === 'max' ? bounds.top : (bounds.bottom + bounds.top) / 2;
    for (const { members, bounds } of entries) for (const object of members) updates.set(object.id, { ...object, [action.axis]: object[action.axis] + coordinate(total) - coordinate(bounds) });
  } else if (action.type === 'duplicate') {
    const groups = new Map();
    const copies = objects.map((object) => {
      if (object.group && !groups.has(object.group)) groups.set(object.group, crypto.randomUUID());
      return { ...object, id: crypto.randomUUID(), ...(object.group ? { group: groups.get(object.group) } : {}) };
    });
    project.artworks.push(...copies.filter((object) => !object.writing));
    project.texts.push(...copies.filter((object) => object.writing));
    selection = copies.map((object) => object.id);
  } else if (action.type === 'delete') {
    project.artworks = project.artworks.filter((object) => !selected.has(object.id));
    project.texts = project.texts.filter((object) => !selected.has(object.id));
    selection = [];
  } else throw new Error('Unknown layout action');
  project.artworks = project.artworks.map((object) => updates.get(object.id) || object);
  project.texts = project.texts.map((object) => updates.get(object.id) || object);
  return { project: validateProject(project), selection };
}
