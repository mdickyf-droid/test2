export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/test' && request.method === 'POST') {
      return testCloudflare(env);
    }

    if (url.pathname === '/api/publish' && request.method === 'POST') {
      return publish(request, env);
    }

    if (url.pathname === '/api/domain' && request.method === 'POST') {
      return addDomain(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
});

function headers(env) {
  return { Authorization: `Bearer ${env.CF_API_TOKEN}` };
}

function cfError(data) {
  return data?.errors?.map(x => x.message).join('; ') || 'Cloudflare API menolak request.';
}

async function testCloudflare(env) {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    return json({ success: false, error: 'Cloudflare secret belum dikonfigurasi di Worker.' }, 500);
  }
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/pages/projects?per_page=1`, {
      headers: headers(env),
    });
    const d = await r.json();
    if (!r.ok || !d.success) return json({ success: false, error: cfError(d) }, r.status || 400);
    return json({ success: true, message: '✓ Cloudflare terhubung.' });
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}

async function publish(request, env) {
  try {
    if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return json({ success:false, error:'Cloudflare secret belum dikonfigurasi di Worker.' },500);
    const { projectName, html } = await request.json();
    const name = String(projectName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 63);
    if (!name || typeof html !== 'string') return json({ success:false, error:'Nama project dan HTML wajib diisi.' },400);

    const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}`;
    const auth = headers(env);

    let project = await fetch(`${base}/pages/projects/${encodeURIComponent(name)}`, { headers: auth });
    if (!project.ok) {
      const create = await fetch(`${base}/pages/projects`, {
        method:'POST',
        headers:{ ...auth, 'content-type':'application/json' },
        body:JSON.stringify({ name, production_branch:'main' }),
      });
      const cd = await create.json();
      if (!create.ok || !cd.success) return json({ success:false, error:cfError(cd) },create.status || 400);
    }

    const worker = `export default { async fetch() { return new Response(${JSON.stringify(html)}, { headers: { 'content-type':'text/html; charset=UTF-8', 'cache-control':'no-cache' } }); } };`;
    const form = new FormData();
    form.append('_worker.js', new Blob([worker], { type:'application/javascript' }), '_worker.js');
    form.append('branch','main');
    form.append('commit_message','Publish from LP Publisher');
    form.append('commit_dirty','false');

    const deploy = await fetch(`${base}/pages/projects/${encodeURIComponent(name)}/deployments`, {
      method:'POST', headers:auth, body:form,
    });
    const dd = await deploy.json();
    if (!deploy.ok || !dd.success) return json({ success:false, error:cfError(dd), details:dd.errors || [] },deploy.status || 400);
    const result = dd.result || {};
    return json({ success:true, deploymentId:result.id, url:result.url || `https://${name}.pages.dev` });
  } catch(e) {
    return json({ success:false, error:e.message },500);
  }
}

async function addDomain(request, env) {
  try {
    if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return json({ success:false, error:'Cloudflare secret belum dikonfigurasi di Worker.' },500);
    const { projectName, domain } = await request.json();
    if (!projectName || !domain) return json({ success:false,error:'Project dan domain wajib diisi.'},400);
    const base=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(projectName)}/domains`;
    const r=await fetch(base,{method:'POST',headers:{...headers(env),'content-type':'application/json'},body:JSON.stringify({name:String(domain).trim().toLowerCase()})});
    const d=await r.json();
    if(!r.ok||!d.success)return json({success:false,error:cfError(d),details:d.errors||[]},r.status||400);
    return json({success:true,domain:d.result});
  }catch(e){return json({success:false,error:e.message},500)}
}
