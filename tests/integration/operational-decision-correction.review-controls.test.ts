import { describe, expect, it } from 'bun:test';
import { createGoodMemory, createInMemoryDocumentStore, createInMemorySessionStore } from '../../src';
import { createSQLiteDocumentStore } from '../../src/storage/sqlite';
import type { FactMemory } from '../../src/domain/records';
import type { DocumentStore, ConditionalDocumentWriteBatch } from '../../src/storage/contracts';
import { SOURCE_MESSAGES_COLLECTION, EVIDENCE_COLLECTION, type SourceMessageRecord } from '../../src/evidence/contracts';
const scope = { userId: 'public-independent-review', workspaceId: 'workspace' };
const old = 'Project decision: We deploy CedarApp with blue-green releases.';
const next = 'Project decision: We now deploy CedarApp with canary releases instead of blue-green releases.';
const final = 'Project decision: We now deploy CedarApp with rolling releases instead of canary releases.';
const day = (n:number) => `2026-09-${String(n).padStart(2,'0')}T00:00:00Z`;
const make = (store:DocumentStore, now:()=>Date = ()=>new Date('2026-10-11T12:00:00Z')) => createGoodMemory({storage:{provider:'memory'}, adapters:{documentStore:store,sessionStore:createInMemorySessionStore()}, testing:{now}});
const write = (m:ReturnType<typeof make>, content:string, id:string, n:number) => m.remember({scope,messages:[{role:'user',content,id,observedAt:day(n)}]});

describe('independent public source review',()=>{
  it('preserves duplicate fact acceptance for basic DocumentStore adapters',async()=>{
    const inner=createInMemoryDocumentStore();
    const store:DocumentStore={get:inner.get,set:inner.set,update:inner.update,delete:inner.delete,query:inner.query};
    const m=make(store);
    expect((await write(m,old,'first',1)).accepted).toBe(1);
    const second=await write(m,old,'second',2);
    console.log('BASIC_ADAPTER_DUPLICATE',JSON.stringify(second));
    expect(second.accepted).toBe(1);
  });
  for(const provider of ['memory','sqlite']) {
    it(`${provider}: does not admit stale first-write after concurrent correction insertion`, async()=>{
      const inner=provider==='memory'?createInMemoryDocumentStore():createSQLiteDocumentStore(':memory:');
      const other=make(inner);
      let injected=false;
      const store={...inner,async query<T extends object>(collection:string,filter?:any):Promise<T[]>{
        const rows=await inner.query<T>(collection,filter);
        if(collection==='facts'&&!injected){
          injected=true;
          expect((await write(other,old,'concurrent-old',1)).accepted).toBe(1);
          expect((await write(other,next,'concurrent-next',3)).accepted).toBe(1);
        }
        return rows;
      }};
      const result=await write(make(store),old,'stale-first',2);
      const facts=await inner.query<FactMemory>('facts');
      console.log('PHANTOM_RACE',provider,JSON.stringify({result,facts:facts.map(f=>({content:f.content,lifecycle:f.lifecycle}))}));
      expect(result.accepted).toBe(0);
      expect(facts.filter(f=>f.lifecycle==='active').map(f=>f.content)).toEqual([next]);
    });
    it(`${provider}: rechecks backfill time validity after source persistence`,async()=>{
      const inner=provider==='memory'?createInMemoryDocumentStore():createSQLiteDocumentStore(':memory:');
      let current=new Date('2026-10-11T12:00:00Z'); let armed=false;
      const store={...inner,async writeBatchIfUnchanged(batch:ConditionalDocumentWriteBatch){
        const restoration=batch.set.some(x=>x.collection===SOURCE_MESSAGES_COLLECTION&&(x.document as SourceMessageRecord).sourceMessageId==='restore');
        const result=await inner.writeBatchIfUnchanged(batch);
        if(armed&&restoration) current=new Date('2026-10-11T12:02:00Z');
        return result;
      }};
      const m=make(store,()=>current);
      await write(m,old,'old',1); await write(m,next,'next',2);
      const target=(await inner.query<FactMemory>('facts')).find(f=>f.content===next)!;
      await inner.set('facts',target.id,{...target,validUntil:'2026-10-11T12:01:00Z'});
      armed=true;
      const result=await write(m,old,'restore',3);
      console.log('BACKFILL_TIME',provider,JSON.stringify(result));
      expect(result.accepted).toBe(0);
    });
    it(`${provider}: requires author source for intermediate lineage`,async()=>{
      const inner=provider==='memory'?createInMemoryDocumentStore():createSQLiteDocumentStore(':memory:');const m=make(inner);
      await write(m,old,'old',1);await write(m,next,'next',2);await write(m,final,'final',4);
      const mid=(await inner.query<SourceMessageRecord>(SOURCE_MESSAGES_COLLECTION)).find(s=>s.content===next)!;
      await inner.delete(SOURCE_MESSAGES_COLLECTION,mid.id);
      const result=await write(m,old,'restore',5);
      console.log('BROKEN_LINEAGE_SOURCE',provider,JSON.stringify(result));
      expect(result.accepted).toBe(0);
    });
  }
});
