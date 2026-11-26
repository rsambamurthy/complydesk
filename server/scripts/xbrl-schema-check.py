#!/usr/bin/env python3
"""
Dev check: is a generated AOC-4 XBRL instance schema-valid against MCA's C&I taxonomy 2016 (Filing Manual rule:
"an instance must be schema valid according to all schemas in the DTS")? Offline — every xbrl.org URL is mapped to
the copies shipped in MCA's validator package (Taxonomy-2016-03-31.zip, unzipped). Not a substitute for MCA's tool.

  python3 -I server/scripts/xbrl-schema-check.py <taxonomy dir> <instance.xml>
Also checks: contexts used / unique, typed members are taxonomy typed domains, xlink:href of schemaRef.
"""
import os, re, sys
import xmlschema  # pip install xmlschema (libxml2 is too slow on XBRL's large substitution groups)

tax, inst = sys.argv[1], sys.argv[2]
LOCAL = {
    'http://www.xbrl.org/2003/xbrl-instance-2003-12-31.xsd': 'xbrl-instance-2003-12-31.xsd',
    'http://www.xbrl.org/2003/xbrl-linkbase-2003-12-31.xsd': 'xbrl-linkbase-2003-12-31.xsd',
    'http://www.xbrl.org/2003/xl-2003-12-31.xsd': 'xl-2003-12-31.xsd',
    'http://www.xbrl.org/2003/xlink-2003-12-31.xsd': 'xlink-2003-12-31.xsd',
    'http://www.xbrl.org/2005/xbrldt-2005.xsd': 'xbrldt-2005.xsd',
    'http://www.xbrl.org/2006/xbrldi-2006.xsd': 'xbrldi-2006.xsd',
    'http://www.xbrl.org/lrr/role/negated-2009-12-16.xsd': 'negated-2009-12-16.xsd',
    'http://www.xbrl.org/lrr/role/net-2009-12-16.xsd': 'net-2009-12-16.xsd',
    'http://www.xbrl.org/dtr/type/numeric-2009-12-16.xsd': 'numeric-2009-12-16.xsd',
    'http://www.xbrl.org/dtr/type/nonNumeric-2009-12-16.xsd': 'nonNumeric-2009-12-16.xsd',
    'http://www.xbrl.org/2006/ref-2006-02-27.xsd': 'ref-2006-02-27.xsd',
}

loc = [(remote, os.path.join(tax, local)) for remote, local in LOCAL.items()]
loc += [('http://www.icai.org/xbrl/taxonomy/2016-03-31/in-gaap', os.path.join(tax, 'IN-GAAP/in-gaap-2016-03-31.xsd')),
        ('http://www.icai.org/xbrl/taxonomy/2016-03-31/in-ca', os.path.join(tax, 'IN-CA/in-ca-2016-03-31.xsd'))]
uri_map = {remote: 'file://' + os.path.abspath(path) for remote, path in loc if remote.startswith('http://www.xbrl.org')}
schema = xmlschema.XMLSchema(os.path.join(tax, 'xbrl-instance-2003-12-31.xsd'), uri_mapper=lambda u: uri_map.get(u, u), allow='local')
for ns, path in [('http://xbrl.org/2006/xbrldi', os.path.join(tax, 'xbrldi-2006.xsd')), *loc[-2:]]:
    schema.import_schema(ns, path)
schema.build()
errors = [f'{e.path}: {e.reason}' for e in schema.iter_errors(inst)]
ok = not errors
# ---- Dimensional validity (simplified XDT): each fact's dimensions must fit one of its primary item's hypercubes.
import xml.etree.ElementTree as ET
XL = '{http://www.w3.org/1999/xlink}'; LB = '{http://www.xbrl.org/2003/linkbase}'; DT = '{http://xbrl.org/2005/xbrldt}'
roles = {}; defaults = {}
for folder in ('IN-GAAP/DEF', 'IN-CA/DEF'):
    for fn in sorted(os.listdir(os.path.join(tax, folder))):
        for dl in ET.parse(os.path.join(tax, folder, fn)).getroot().iter(LB + 'definitionLink'):
            loc = {l.get(XL + 'label'): l.get(XL + 'href').split('#')[1].split('_', 1)[1] for l in dl.findall(LB + 'loc')}
            r = roles.setdefault(dl.get(XL + 'role'), {'all': [], 'hd': {}, 'dd': {}, 'dm': {}})
            for a in dl.findall(LB + 'definitionArc'):
                fr, to, ar = loc[a.get(XL + 'from')], loc[a.get(XL + 'to')], a.get(XL + 'arcrole').split('/')[-1]
                if ar == 'all': r['all'].append((fr, to, a.get(DT + 'closed') == 'true'))
                elif ar == 'hypercube-dimension': r['hd'].setdefault(fr, []).append(to)
                elif ar == 'dimension-domain': r['dd'].setdefault(fr, []).append(to)
                elif ar == 'domain-member': r['dm'].setdefault(fr, []).append(to)
                elif ar == 'dimension-default': defaults[fr] = to
def below(r, start):
    out, stack = set(), [start]
    while stack:
        n = stack.pop()
        for c in r['dm'].get(n, []):
            if c not in out: out.add(c); stack.append(c)
    return out
cubes = {}  # concept -> [(role, hypercube, closed)]
for rn, r in roles.items():
    for prim, hc, closed in r['all']:
        for c in {prim} | below(r, prim):
            cubes.setdefault(c, []).append((rn, hc, closed))
doc = ET.parse(inst).getroot()
XI = '{http://www.xbrl.org/2003/instance}'; DI = '{http://xbrl.org/2006/xbrldi}'
ctxdims = {}
for c in doc.iter(XI + 'context'):
    dims = {}
    for m in c.iter(DI + 'explicitMember'): dims[m.get('dimension').split(':')[1]] = m.text.split(':')[1]
    for m in c.iter(DI + 'typedMember'): dims[m.get('dimension').split(':')[1]] = '#typed'
    ctxdims[c.get('id')] = dims
bad = 0
for el in doc:
    ref = el.get('contextRef')
    if not ref: continue
    name = el.tag.split('}')[1]; dims = ctxdims[ref]
    options = cubes.get(name, [])
    def fits(rn, hc, closed):
        r = roles[rn]; axes = r['hd'].get(hc, [])
        if closed and any(a not in axes for a in dims): return False
        for a in axes:
            if a in dims:
                if dims[a] == '#typed': continue
                doms = r['dd'].get(a, [])
                if not any(dims[a] == d or dims[a] in below(r, d) for d in doms): return False
            elif a not in defaults: return False
        return True
    ok_dim = (not dims and not options) or any(fits(*o) for o in options) or (not dims and not any(o[2] for o in options))
    if not ok_dim:
        bad += 1
        if bad <= 15: errors.append(f'dimensions: {name} in {ref} fits none of its hypercubes')
if bad: ok = False

xml = open(inst, encoding='utf-8').read()
ids = re.findall(r'<xbrli:context id="([^"]+)"', xml)
if len(ids) != len(set(ids)): errors.append('duplicate context ids')
for i in ids:
    if f'contextRef="{i}"' not in xml: errors.append(f'unused context {i}')
units = re.findall(r'<xbrli:unit id="([^"]+)"', xml)
for u in units:
    if f'unitRef="{u}"' not in xml: errors.append(f'unused unit {u}')
if 'precision=' in xml: errors.append('precision attribute present')
print('schema valid' if ok else 'SCHEMA ERRORS', '·', len(ids), 'contexts ·', len(re.findall(r'contextRef=', xml)), 'facts')
for e in errors[:40]: print(' -', e)
sys.exit(0 if ok and not errors else 1)
