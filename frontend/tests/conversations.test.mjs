import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directConversation } from '../src/lib/conversations.ts';

test('an agent reopens its real chat even after a rename or an empty duplicate',()=>{
  const rows=[
    {id:'later',title:'Bot agent-a',bot_ids:['agent-a'],is_group:false,created_at:'2026-10-21T12:00:00'},
    {id:'wrong',title:'Bot agent-a',bot_ids:['agent-b'],is_group:false,created_at:'2026-10-20T09:00:00'},
    {id:'group',title:'Shared',bot_ids:['agent-a','agent-b'],is_group:true,created_at:'2026-10-19T09:00:00'},
    {id:'original',title:'My saved results',bot_ids:['agent-a'],is_group:false,created_at:'2026-10-20T10:00:00'},
  ];
  assert.equal(directConversation(rows,'agent-a')?.id,'original');
  assert.equal(directConversation(rows,'new-agent'),undefined);
});
