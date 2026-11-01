# Build Anna artwork through an external PSD2Live server. Requires its mcp_proxy.py.
import sys,json,pathlib
import os,shutil
checkout=os.environ.get('PSD2LIVE_CHECKOUT')
if not checkout: raise SystemExit('Set PSD2LIVE_CHECKOUT to the external PSD2Live checkout; set PSD2LIVE_MCP_ENDPOINT and PSD2LIVE_MCP_TOKEN for its headless server.')
sys.path.insert(0,checkout)
from mcp_proxy import Client
repo=pathlib.Path(__file__).resolve().parents[2]
root=repo/'artifacts/live2d-authoring'
root.mkdir(parents=True,exist_ok=True)
source=repo/'artwork/anna-live2d/source'
with Client() as c:
 layers=[dict(path=str(source/'anna.png'),name='Anna',role='unknown',x=0,y=0),dict(path=str(root/'eyelidR.png'),name='EyelidR',role='unknown',x=490,y=212),dict(path=str(root/'eyelidL.png'),name='EyelidL',role='unknown',x=599,y=260),dict(path=str(root/'mouth.png'),name='Mouth',role='unknown',x=498,y=330)]
 c.edit('project_create_artwork',width=1664,height=941,layers=layers,discard_unsaved=True)
 c.edit('settings_update',changes={'runtimeTarget':'Cubism40','meshSpacing':26,'meshOnly':True,'generateDeformers':False,'generatePhysics':False,'exportMotions':False,'exportCmo3':True,'seeThroughEyes':False,'seeThroughBrows':False})
 objects=c.call('workspace_inspect',{'scope':'objects','limit':64})[0]['items']; meshes={o['name']:o['target'] for o in objects if o['target'].startswith('mesh:')}
 def edit(op,**args):
  r=c.edit(op,**args);print(op,args.get('id',args.get('parameter',{}).get('id','')),flush=True);return r
 # Authored expression opacity tracks. Eye-open=1 is the neutral face, eye-open=0 the eyelid.
 changes=[]
 for name,param in [('EyelidL','ParamEyeLOpen'),('EyelidR','ParamEyeROpen'),('Mouth','ParamMouthOpenY')]:
  for key in [0,1]:
   changes.append({'op':'seed','target':meshes[name],'key':{param:key}})
   changes.append({'op':'set','target':meshes[name],'key':{param:key},'channels':{'opacity':key if name=='Mouth' else 1-key,'drawOrder':600 if name=='Mouth' else 610}})
 # Body must stay behind every expression layer, regardless of source-table display ordering.
 edit('keyform_apply',changes=changes)
 def warp(id,previous=None,rows=12,columns=12):
  args=dict(id=id,name=id,meshes=[m.split(':',1)[1] for m in meshes.values()] if previous is None else [],rows=rows,columns=columns,bounds={'x':0,'y':0,'w':1150,'h':960})
  if previous: args.update(add_to='parent_of_deformer',deformer_id=previous)
  edit('canvas_warp',**args)
  return 'warp:'+id
 def axis(param,target,ops,values=(-30,30),default=0):
  shapes=[{'target':target,'value':v,'operations':ops(v)} for v in values]
  edit('author_axis',parameter={'id':param},shapes=shapes,summary='Anna appearance: '+param)
 headSel={'center':[.50,.29],'radius':.52,'feather':.48}
 target=warp('AnnaHeadXY')
 axis('ParamAngleX',target,lambda v:[{'type':'translate','delta':[v/30*.017,0],'selection':headSel}])
 axis('ParamAngleY',target,lambda v:[{'type':'translate','delta':[0,v/30*.013],'selection':headSel}])
 target=warp('AnnaHeadTilt','AnnaHeadXY')
 axis('ParamAngleZ',target,lambda v:[{'type':'rotate','degrees':v/30*2.8,'pivot':[.50,.48],'selection':headSel}])
 target=warp('AnnaBreath','AnnaHeadTilt',rows=8,columns=8)
 axis('ParamBreath',target,lambda v:[{'type':'scale','factors':[1+v*.001,1+v*.004],'pivot':[.50,1]}],values=(1,))
 axis('ParamBodyAngleX',target,lambda v:[{'type':'translate','delta':[v/10*.005,0],'selection':{'center':[.49,.50],'radius':.70,'feather':.50}}],values=(-10,10))
 target=warp('AnnaHairSway','AnnaBreath',rows=16,columns=16)
 axis('ParamHairFront',target,lambda v:[{'type':'translate','delta':[v*.004,0],'selection':{'center':[.20,.59],'radius':.24,'feather':.22}},{'type':'translate','delta':[-v*.003,0],'selection':{'center':[.71,.55],'radius':.20,'feather':.18}}],values=(-1,1))
 target=warp('AnnaGaze','AnnaHairSway',rows=32,columns=32)
 eyeSels=[{'center':[553/1150,260/960],'radius':.055,'feather':.045},{'center':[660/1150,310/960],'radius':.055,'feather':.045}]
 axis('ParamEyeBallX',target,lambda v:[{'type':'translate','delta':[v*.0018,0],'selection':s} for s in eyeSels],values=(-1,1))
 axis('ParamEyeBallY',target,lambda v:[{'type':'translate','delta':[0,v*.0015],'selection':s} for s in eyeSels],values=(-1,1))
 target=warp('AnnaExpression','AnnaGaze',rows=24,columns=24)
 for param,center in [('ParamBrowRY',[.49,.235]),('ParamBrowLY',[.585,.275])]:
  axis(param,target,lambda v,center=center:[{'type':'translate','delta':[0,-v*.0025],'selection':{'center':center,'radius':.07,'feather':.06}}],values=(-1,1))
 axis('ParamMouthForm',target,lambda v:[{'type':'scale','factors':[1+v*.025,1-v*.015],'pivot':[562/1150,382/960],'selection':{'center':[562/1150,382/960],'radius':.09,'feather':.07}}],values=(-1,1))
 edit('project_save_as',path=str(root/'anna.psd2live'))
 edit('project_export_model',output_directory=str(root/'export'))
 for scope in ['objects','parameters']:
  d,_=c.call('workspace_inspect',{'scope':scope,'limit':64});(root/('rig-'+scope+'.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2))
 print('EXPORT COMPLETE',flush=True)

# Keep runtime assets small; editable source belongs to artwork/, outside the public directory.
export=root/'export'
out=repo/'assets/anna-room'
(out/'textures').mkdir(parents=True,exist_ok=True)
m=json.loads((export/'model.model3.json').read_text())
m['FileReferences'].update(Moc='anna.moc3',DisplayInfo='anna.cdi3.json',Textures=['textures/texture_00.png'])
(out/'anna.model3.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
for old,new in [('model.moc3','anna.moc3'),('model.cdi3.json','anna.cdi3.json'),('model.4096/texture_00.png','textures/texture_00.png')]: shutil.copy2(export/old,out/new)
shutil.copy2(export/'model.cmo3',repo/'artwork/anna-live2d/anna.cmo3')
shutil.copy2(root/'anna.psd2live',repo/'artwork/anna-live2d/anna.psd2live')
