type DirectConversation = {id:string;title:string;is_group:boolean;bot_ids:string[];created_at?:string};

// Titles are editable presentation. Membership identifies an agent's chat.
// Keep the first chat as its default; explicit activity links select other IDs.
export function directConversation(conversations:DirectConversation[],botId:string):DirectConversation|undefined {
  return conversations.filter(c=>!c.is_group && c.bot_ids.length===1 && c.bot_ids[0]===botId)
    .sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''))[0];
}
