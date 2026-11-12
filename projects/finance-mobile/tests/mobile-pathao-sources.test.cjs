const {test}=require('node:test');
const assert=require('node:assert/strict');
const {nativeHarness,button,text,React,create,act}=require('./helpers/native-harness.cjs');
const entry={id:'saved-one',account_name:'Synthetic wallet',date:'2026-01-02',amount:'100.00',balance_after:'900.00',description:'Synthetic merchant',note:'',type:'expense',direction:'debit'};
const preview={available:true,reference:'SYNTH123456',keep:entry.id,preview_token:'signed-synthetic',can_resolve:true,blockers:[],sources:[{id:'sms-one',sender:'Pathao.Pay',text:'Synthetic notification',received_at:'2026-01-02T12:00:00+06:00',status:'confirmed',transaction:entry.id,amount:'100.00',direction:'debit',balance_after:'900.00',fee_amount:null}],transactions:[entry,{...entry,id:'saved-two'}]};
test('source merge requires one explicit confirmation and preserves the current editor entry',async()=>{
 let submitted=[],saved=0,tree;
 const h=nativeHarness({getPathaoSources:async()=>preview,resolvePathaoSources:async(...args)=>{submitted.push(args);return {transaction:entry.id};}});
 const {PathaoSourceReview}=h.load('pathao-source-review');
 await act(async()=>{tree=create(React.createElement(PathaoSourceReview,{id:'sms-one',token:'synthetic-token',keepTransactionId:entry.id,onClose(){},onSaved(){saved++;}}));});
 assert.match(text(tree),/1 SMS · 2 saved entries/);
 const submit=button(tree,'Merge entries · keep all sources');assert.equal(submit.props.disabled,true);
 assert.equal(button(tree,`Synthetic wallet · 2026-01-02 · BDT 100.00 · Synthetic merchant`).props.disabled,true);
 await act(async()=>tree.root.findAllByType('Pressable').find(node=>node.props.accessibilityRole==='checkbox').props.onPress());
 await act(async()=>button(tree,'Merge entries · keep all sources').props.onPress());
 assert.equal(saved,1);assert.equal(submitted.length,1);assert.equal(submitted[0][2],preview.preview_token);
 await act(async()=>tree.unmount());
});
test('stale source preview clears confirmation and keeps originals reviewable',async()=>{
 let tree;
 const h=nativeHarness({getPathaoSources:async()=>preview,resolvePathaoSources:async()=>{throw new Error('Sources changed. Refresh comparison.');}});
 const {PathaoSourceReview}=h.load('pathao-source-review');
 await act(async()=>{tree=create(React.createElement(PathaoSourceReview,{id:'sms-one',token:'synthetic-token',onClose(){},onSaved(){throw Error('must not save');}}));});
 await act(async()=>tree.root.findAllByType('Pressable').find(node=>node.props.accessibilityRole==='checkbox').props.onPress());
 await act(async()=>button(tree,'Merge entries · keep all sources').props.onPress());
 assert.match(text(tree),/Sources changed/);assert.equal(button(tree,'Merge entries · keep all sources').props.disabled,true);
 await act(async()=>tree.unmount());
});
