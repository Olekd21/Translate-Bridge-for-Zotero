async(page)=>{
 await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
 await page.evaluate(()=>{document.body.innerHTML='<input id="pairing-token"><button id="save"></button><button id="retry"></button><p id="status"></p><p id="version"></p><button id="clear-outbox"></button><div id="outbox-list"></div>';window.confirm=()=>true;let rows=[{queueID:'1',annotation:{document:{title:'A'},selector:{exact:'First note'}},reason:'offline'},{queueID:'2',annotation:{document:{title:'B'},selector:{exact:'Second note'}},reason:'offline'}];window.chrome={storage:{local:{get:async()=>({pairingToken:'test',outbox:rows})},onChanged:{addListener(){}}},runtime:{getManifest:()=>({version:'test'}),sendMessage:async msg=>{if(msg.removeIDs)rows=rows.filter(r=>!msg.removeIDs.includes(r.queueID));return {ok:true,entries:rows};}}};});
 await page.addScriptTag({url:'http://127.0.0.1:18841/packages/browser-extension/options.js'});
 await page.waitForTimeout(100);
 if(await page.locator('#outbox-list article').count()!==2)throw Error('queue list');
 await page.locator('#outbox-list button').first().click();await page.waitForTimeout(100);
 if(await page.locator('#outbox-list article').count()!==1)throw Error('single remove');
 await page.locator('#clear-outbox').click();await page.waitForTimeout(100);
 if(!(await page.locator('#clear-outbox').isDisabled())||!(await page.locator('#outbox-list').textContent()).includes('没有待同步'))throw Error('clear');
 return {passed:['queue list shows failures','single removal','clear all and disabled empty action']};
}
