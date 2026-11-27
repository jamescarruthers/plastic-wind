// Minimal 3MF (core spec + base materials) writer. One object per part.

import { zipSync, strToU8 } from 'fflate';

export interface ThreeMfPart {
  name: string;
  color: string; // #rrggbb
  positions: Float32Array; // xyz, mm
  indices: Uint32Array;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (x: number) => {
  const r = Math.round(x * 1e4) / 1e4;
  return Object.is(r, -0) ? '0' : String(r);
};

export function buildModelXml(parts: ThreeMfPart[], title: string): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
  );
  out.push(`<metadata name="Title">${esc(title)}</metadata>`);
  out.push('<metadata name="Application">Plastic Wind</metadata>');
  out.push(`<metadata name="CreationDate">${new Date().toISOString().slice(0, 10)}</metadata>`);
  out.push('<resources>');
  out.push('<basematerials id="1">');
  for (const p of parts) out.push(`<base name="${esc(p.name)}" displaycolor="${p.color.toUpperCase()}FF"/>`);
  out.push('</basematerials>');
  parts.forEach((p, i) => {
    const id = i + 2;
    out.push(`<object id="${id}" type="model" name="${esc(p.name)}" pid="1" pindex="${i}"><mesh><vertices>`);
    const v = p.positions;
    const chunk: string[] = [];
    for (let k = 0; k < v.length; k += 3) chunk.push(`<vertex x="${num(v[k])}" y="${num(v[k + 1])}" z="${num(v[k + 2])}"/>`);
    out.push(chunk.join(''));
    out.push('</vertices><triangles>');
    const t = p.indices;
    const tc: string[] = [];
    for (let k = 0; k < t.length; k += 3) tc.push(`<triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}"/>`);
    out.push(tc.join(''));
    out.push('</triangles></mesh></object>');
  });
  out.push('</resources>');
  out.push('<build>');
  parts.forEach((_, i) => out.push(`<item objectid="${i + 2}"/>`));
  out.push('</build>');
  out.push('</model>');
  return out.join('\n');
}

export function build3mf(parts: ThreeMfPart[], title: string, notes?: string): Uint8Array {
  const types =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '<Default Extension="txt" ContentType="text/plain"/>' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    '</Relationships>';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(types),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(buildModelXml(parts, title)),
  };
  if (notes) files['Metadata/build-notes.txt'] = strToU8(notes);
  return zipSync(files, { level: 6 });
}
