'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPatch, cleanSavedPreferences, cleanFavorites, cleanFavoriteStyleIds, setFavoriteStyleCatalog, cleanDetailsContext, cleanDetailsRegions } = require('./preferences.cjs');
const { detailsPlacement } = require('./geometry.cjs');

test('cross-sport selections, style and favorites survive desktop validation without losing league identity', () => {
  const favorites = [
    { leagueId: 'nfl', teamId: '3', name: 'Chicago Bears', abbreviation: 'CHI', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/chi.png', color: '#0b162a' },
    { leagueId: 'nba', teamId: 'nba:4', name: 'Chicago Bulls', abbreviation: 'CHI' },
    { leagueId: 'eng.1', teamId: 'eng.1:359', name: 'Arsenal', abbreviation: 'ARS' }
  ];
  const patch = { leagueId: 'nba', gameId: 'nba:401000002', styleId: 'nba-nbc-pods', favorites, scale: 1.3 };
  assert.deepEqual(cleanPatch(patch), patch);
  assert.deepEqual(cleanFavorites([...favorites, favorites[0]]), favorites);
  assert.equal(cleanPatch({ gameId: 'f1:9568' }).gameId, 'f1:9568');
  assert.equal(cleanPatch({ gameId: 'fox-123' }).gameId, 'fox-123');
  assert.equal(cleanPatch({ gameId: null, team: null }).gameId, null);
});

test('F1 driver count and an explicitly selected style survive native validation and saved JSON restoration', async () => {
  const { normalizePreferencePatch } = await import('../public/preferences-model.js');
  for (const racingRows of [3,6,20,22,40,60]) for (const styleAuto of [false,true]) {
    const patch = {leagueId:'f1',gameId:'f1:401000001',styleId:'f1-rounded-tower',racingRows,styleAuto};
    const saved = JSON.parse(JSON.stringify(cleanPatch(patch)));
    assert.deepEqual(cleanPatch(saved), patch);
    assert.deepEqual(normalizePreferencePatch(saved), patch);
  }
  for (const [value,expected] of [[0,3],[2,3],[8.8,9],[1000,60]]) {
    assert.equal(cleanPatch({racingRows:value}).racingRows, expected);
    assert.deepEqual(cleanPatch({racingRows:value}), normalizePreferencePatch({racingRows:value}));
  }
  for (const value of [null,undefined,'22',NaN,Infinity,{},[]]) assert.throws(() => cleanPatch({racingRows:value}), /driver row count/);
  for (const value of [null,undefined,'false',0,1,{},[]]) assert.throws(() => cleanPatch({styleAuto:value}), /styleAuto/);
  const basketball = {leagueId:'nba',styleId:'nfl-blades',styleAuto:false};
  assert.deepEqual(cleanPatch(basketball), basketball, 'native preferences retain a cross-sport selection');
});

test('upgrading saved desktop styles preserves the choice without changing new-profile or partial-patch defaults', () => {
  for (const styleId of ['nfl-blades','nfl-cbs-eyebar','f1-rounded-tower']) {
    const legacy = {leagueId:'nba',styleId,scale:1.2};
    const migrated = cleanSavedPreferences(JSON.parse(JSON.stringify(legacy)));
    assert.deepEqual(migrated, {...legacy,styleAuto:false});
    assert.deepEqual(cleanSavedPreferences(JSON.parse(JSON.stringify(migrated))), migrated);
    assert.deepEqual(cleanPatch(legacy), legacy, 'a normal partial patch must not infer styleAuto');
    for (const styleAuto of [false,true]) assert.deepEqual(cleanSavedPreferences({...legacy,styleAuto}), {...legacy,styleAuto});
  }
  for (const saved of [{},{scale:.8},{styleAuto:true},{styleAuto:false}]) assert.deepEqual(cleanSavedPreferences(saved), saved);
  assert.equal(({styleAuto:true,...cleanSavedPreferences({})}).styleAuto,true);
  assert.throws(()=>cleanSavedPreferences({styleId:'bad/style'}),/Invalid scorebug style/);
});

test('favorite styles validate against the shared catalog and survive native saved-setting round trips', async () => {
  const { SCOREBUG_STYLES } = await import('../public/scorebug-styles.js');
  const { normalizeFavoriteStyleIds } = await import('../public/preferences-model.js');
  setFavoriteStyleCatalog(SCOREBUG_STYLES);
  const all = SCOREBUG_STYLES.map(style => style.id);
  assert.equal(all.length,83);
  for (const input of [[], ['nfl-blades','nba-nbc-pods','nfl-blades','unknown',null,12], [...all,...all]]) {
    assert.deepEqual(cleanFavoriteStyleIds(input),normalizeFavoriteStyleIds(input));
    assert.ok(cleanFavoriteStyleIds(input).length<=all.length);
  }
  const patch={leagueId:'f1',gameId:'f1:123',styleId:'nfl-cbs-eyebar',styleAuto:false,racingRows:22,
    favorites:[{leagueId:'nfl',teamId:'3',name:'Chicago Bears',abbreviation:'CHI'}],favoriteStyleIds:all};
  const saved=JSON.parse(JSON.stringify(cleanPatch(patch)));
  assert.deepEqual(cleanSavedPreferences(saved),patch);
  const copied=cleanPatch(patch);copied.favoriteStyleIds.pop();
  assert.equal(patch.favoriteStyleIds.length,all.length);
  assert.deepEqual(cleanPatch({favoriteStyleIds:['unknown','../../private']}),{favoriteStyleIds:[]});
  for (const invalid of [null,undefined,{},'nfl-blades',42]) assert.throws(()=>cleanPatch({favoriteStyleIds:invalid}),/must be a list/);
  assert.deepEqual(cleanSavedPreferences({styleId:'nfl-blades',racingRows:22}),{styleId:'nfl-blades',racingRows:22,styleAuto:false},'old settings remain valid without style favorites');
});

test('desktop favorites reject mismatched namespaces and cap saved metadata', () => {
  assert.throws(() => cleanFavorites([{ leagueId: 'nba', teamId: 'nfl:4' }]), /different league/);
  assert.throws(() => cleanFavorites([{ leagueId: 'nba', teamId: '4' }]), /include their league/);
  assert.throws(() => cleanFavorites(Array.from({length: 65}, () => ({leagueId:'nfl',teamId:'3'}))), /64/);
  const saved = cleanFavorites([{ leagueId: 'nfl', teamId: '3', name: 'A'.repeat(200), abbreviation: 'B'.repeat(100), logo:'https://evil.example/team.png', color:'url(javascript:evil)' }])[0];
  assert.equal(saved.name.length, 100);
  assert.equal(saved.abbreviation.length, 16);
  assert.equal(saved.logo, undefined);
  assert.equal(saved.color, undefined);
  assert.equal(cleanFavorites([{ leagueId:'nfl',teamId:'3',logo:'https://evil.example@a.espncdn.com/x' }])[0].logo, undefined);
  assert.equal(cleanFavorites([{ leagueId:'nba',teamId:'nba:4',logo:'/logos/nba/chi.png' }])[0].logo, '/logos/nba/chi.png');
  assert.equal(cleanFavorites([{ leagueId:'nfl',teamId:'3',logo:'/logos/chi.png' }])[0].logo, '/logos/chi.png');
  assert.equal(cleanFavorites([{ leagueId:'nfl',teamId:'3',logo:'/logos/../private.png' }])[0].logo, undefined);
  assert.throws(() => cleanFavorites([{ leagueId:'nfl',teamId:'nfl:3' }]), /NFL/);
  assert.throws(() => cleanPatch({ gameId:'nba:../../private' }), /Invalid/);
  assert.throws(() => cleanPatch({ leagueId:'https://foo' }), /Invalid/);
  assert.throws(() => cleanPatch({ styleId:'<script>' }), /Invalid/);
});

test('hover game context cannot cross sports even when provider numeric IDs repeat', () => {
  assert.deepEqual(cleanDetailsContext({gameId:'nba:123',leagueId:'nba'}),{gameId:'nba:123',leagueId:'nba'});
  assert.deepEqual(cleanDetailsContext({gameId:'123',leagueId:'nfl'}),{gameId:'123',leagueId:'nfl'});
  assert.deepEqual(cleanDetailsContext({gameId:null,leagueId:'f1'}),{gameId:null,leagueId:'f1'});
  assert.throws(() => cleanDetailsContext({gameId:'123',leagueId:'nba'}), /different league/);
  assert.throws(() => cleanDetailsContext({gameId:'nba:123',leagueId:'nfl'}), /different league/);
});

test('renderer measured hover rectangles are bounded, namespaced and never control other windows', () => {
  const layout = {styleId:'nba-pods', targets:[{side:'comparison',x:40,y:80,width:60,height:20}],
    panels:{comparison:{x:10,y:80,width:140,height:30,fill:'#222222',border:'#111111',ink:'#ffffff'}},
    board:{x:8,y:8,width:144,height:280}};
  assert.deepEqual(cleanDetailsRegions(layout,{width:160,height:320}),layout);
  assert.deepEqual(cleanDetailsRegions({targets:[],panels:{},styleId:'nba-pods'},{width:160,height:320}).targets,[]);
  for (const invalid of [{...layout,targets:[{side:'away',x:-10,y:2,width:10,height:10}]},
    {...layout,targets:[{side:'away',x:150,y:2,width:20,height:10}]},
    {...layout,targets:[{side:'away',x:2,y:2,width:NaN,height:10}]},
    {...layout,targets:[{side:'evil',x:2,y:2,width:10,height:10}]}]) {
    assert.throws(()=>cleanDetailsRegions(invalid,{width:160,height:320}));
  }
});

test('alternate style blades join their measured panel edge at both side anchors', () => {
  const workArea={x:0,y:25,width:1440,height:850};
  const layout={styleId:'nba-pods',targets:[],panels:{away:{x:12,y:40,width:136,height:85,fill:'#dd0000',border:'#880000',ink:'#ffffff'}},board:{x:8,y:30,width:144,height:280}};
  for (const x of [16,1264]) {
    const widget={x,y:280,width:160,height:320};
    const {bounds,presentation}=detailsPlacement(widget,workArea,{side:'away',orientation:'vertical',measuredLayout:layout});
    assert.equal(presentation.direction,x===16?'right':'left');
    assert.equal(presentation.gradientX,widget.x+12-bounds.x);
    assert.equal(presentation.gradientY,widget.y+40-bounds.y);
    assert.equal(presentation.gradientHeight,85);
    assert.equal(presentation.teamFill,'#dd0000');
    assert.ok(bounds.x>=workArea.x && bounds.x+bounds.width<=workArea.width);
    assert.ok(bounds.y>=workArea.y && bounds.y+bounds.height<=workArea.y+workArea.height);
    assert.equal(bounds.y+presentation.joinTop,widget.y+40);
    assert.equal(bounds.y+presentation.joinBottom,widget.y+125);
  }
});
