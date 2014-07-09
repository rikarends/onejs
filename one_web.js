"use strict"
// ONEJS Runtime
// Copyright (C) 2014 ONEJS 

ONE.worker_boot_ = function(host){
	host.onmessage = function(event){
		var msg = event.data
		if(msg._id == 'eval'){ // lets parse and eval a module
			var ast = ONE.root.$['_' + msg.module]
			if(!ast){
				return console.log('Module ' + msg.module + ' not parsed')
			}
			ONE.root.$[msg.module] = ONE.root.eval(ast, msg.module)
			return
		}
		if(msg._id == 'parse'){
			ONE.root.$['_' + msg.module] = ONE.root.parse('->{' + msg.value + '\n}', msg.module)
			return
		}
		if(msg._id == 'run'){
			ONE.root.$[msg.module].call(ONE.root)
			return
		}
	}
	ONE.proxy_flush = function(){
		host.postMessage(ONE.proxy_queue)
		ONE.proxy_start = Date.now()
		ONE.proxy_queue = []
	}
	ONE.proxy_start = Date.now()
	ONE.proxy_queue = []
	ONE.proxy_uid = 1
	ONE.proxy_free = []
	ONE.init_()
	ONE.root = ONE.Base.create(ONE,function(){ this.__class__='Root'})
}


ONE.proxy_ = function(){
	this.Base.Proxy = this.Base.extend(function(){
		this._init = function(){
			if(typeof this.init == 'function') this.init()
			// we have to send our object over to the other side
			var uid
			if(!ONE.proxy_free.length) uid = ONE.proxy_uid++
			else uid = ONE.proxy_free.pop()

			var msg = {_uid_: uid}
			this._uid_ = uid

			var src = this.proxy()

			msg._init_ = src
			// these are all the properties we are going to transfer
			var props = this._props_
			if(props){
				for(var i = 0, l = props.length; i<l; i++){
					var k = props[i]
					var v = this[k]
					if(v._signal_) msg[k] = v.value
					else msg[k] = v
				}
			}

			// and these are all the references we need to store
			var refs = this._refs_
			if(refs){
				for(var i = 0, l = refs.length; i<l; i++){
					var k = refs[i]
					msg[k] = this[k]._uid_
				}
			}

			// push the message in the queue
			var queue = ONE.proxy_queue
			var start = ONE.proxy_start
			var now = Date.now()
			if(now - start < 50){ // make sure we chunk every 50ms
				if(queue.push(msg) == 1){
					setTimeout(ONE.proxy_flush, 0)
				}
			}
			else{
				queue.push(msg)
				ONE.proxy_flush()
			}
		}
		
		this.proxy = function( value, name ){
			value = value || this.init
			name = name || 'init'
			var code = value._remote_
			if(code) return code

			// lets compile the value.bind
			if(!value || !value.bind) throw new Error('cannot compile '+name)
			var ast = value.bind
			var js = this.AST.ToJS
			js.new_state()
			// plug the module of the ast node
			js.module = ast.module

			code = 'this.' + name + ' = ' + js.expand(ast) + '\n'

			var refs = this._refs_
			if(refs){
				for(var i = 0, l = refs.length; i<l; i++){
					var k = refs[i]
					code += 'this.' + k + ' = ONE.proxy_obj[this.' + k + ']\n'
				}
			}

			value._remote_ = code

			return code
		}
	})
}

ONE._createWorker = function(){
	var dt = Date.now()
	var source =
		'\nONE = {}' +
		'\nvar Assert'+
		'\nONE.init_ = ' + ONE.init_.toString() +
		'\nONE.base_ = ' + ONE.base_.toString() +
		'\nONE.signal_ = ' + ONE.signal_.toString() +
		'\nONE.proxy_ = ' + ONE.proxy_.toString() +
		'\nONE.ast_ = ' + ONE.ast_.toString() +
		'\nONE.genjs_ = ' + ONE.genjs_.toString() +
		'\nONE.color_ = ' + ONE.color_.toString() +
		'\nONE.parser_strict_ = ' + ONE.parser_strict_.toString() +
		'\nONE.worker_boot_ = ' + ONE.worker_boot_.toString() +
		'\nONE.worker_boot_(self)'

	var blob = new Blob([source], { type: "text/javascript" })
	this._worker_url = URL.createObjectURL(blob)
	var worker = new Worker(this._worker_url)
	return worker
}

// Bootstrap code for the browser, started at the bottom of the file
ONE.browser_boot_ = function(){

	var fake_worker = false
	var worker
	
	// fake worker for debugging
	if(fake_worker){
		worker = {
			postMessage: function(msg){
				host.onmessage({data:msg})
			},
			onmessage:function(){}
		}
		var host = {
			postMessage: function(msg){
				worker.onmessage({data:msg})
			},
			onmessage: function(){}
		}
		ONE.worker_boot_(host)
	}
	else worker = ONE._createWorker()

	ONE.proxy_code = {}
	ONE.proxy_obj = {}
	var dt = 0
	worker.onmessage = function(event){
		var msg = event.data
		// we have to create an object
		if(Array.isArray(msg)){

			for(var i = 0, l = msg.length;i < l;i++){
				var obj = msg[i]
				ONE.proxy_obj[obj._uid_] = obj
				var code = obj._init_
				var init = ONE.proxy_code[code]
				if(!init){
					init = ONE.proxy_code[code] = Function('module', code)
				}
				// initialize object
				init.call(obj, {})
				if(obj.init) obj.init()
			}
		}
	}

	ONE.signal_.call( this.Signal = {} )

	function reloader(){
		var rtime = Date.now()
		var x = new XMLHttpRequest()
		x.onreadystatechange = function(){
			if(x.readyState != 4) return
			if(x.status == 200){
				//console.clear()
				return location.reload()
			}
			setTimeout(reloader, (Date.now() - rtime) < 1000?500:0)
		}
		x.open('GET', "/_reloader_")
		x.send()
	}

	function module_get( url, module ){
		return ONE.Signal.wrap(function(sig){
			var elem = document.getElementById(module)
			if(elem){
				var value = elem.innerHTML
				worker.postMessage({_id:'parse', module:module, value:value})
				return sig.end(value)
			}
			// do some XMLHTTP
			var pthis = this
			var req = new XMLHttpRequest()
			req.open("GET",url,true)
			req.onreadystatechange = function(){
				if(req.readyState == 4){
					if(req.status != 200) return sig.throw(req.status)
					var value = req.responseText
					worker.postMessage({_id:'parse', module:module, value:value})
					return sig.end(value)
				}
			}
			req.send()
		})
	}
	
	var type = "main"
	var root
	if(location.hash){
		reloader()
		root = location.hash.slice(1)
		var hack = location.hash.indexOf('?')
		if(hack !== -1) root = root.slice(0,hack-1)
	}
	else root = type
	
	function init(){

		var loader = {}
		// when do we resolve a module? when all its deps have been loaded.
		function load_dep( module ){
			// lets load a module
			return ONE.Signal.wrap(function(sig){
				var url = module + '.n'
				var data_sig = loader[module]
				var first = false
				if(!data_sig){
					first = true
					data_sig = loader[module] = module_get(url, module)
				}
				// otherwise we only resolve sig
				data_sig.then(function(value){
					// okay lets scan for our dependencies
					var all = []
					value.replace(/import\s+(\w+)/g, function(m, mod){
						all.push(load_dep(mod))
					})
					ONE.Signal.all(all).then(function(){
						if(first) worker.postMessage({_id:'eval', module:module})
						sig.end()
					}, 
					function(err){
						sig.throw(err)
					})
				}, 
				function(err){
					sig.throw(err)	
				})
			})
		}
		
		load_dep(root).then(function(){
			worker.postMessage({_id:'run', module:root})	
		})
	}
	if(location.hostname.match(/(.*?)\.onejs\.io/)){
		// we are packed, wait 
		window.addEventListener("load", init)
	}
	else {
		init()
	}

	// initialize ONEJS also on the main thread	
	if(!fake_worker) ONE.init_()

	window.onerror = function(msg, url, line) {
		var name = url.match(/[^\/]*$/)[0]
		ONE.error(msg + ' in '+name+' line '+line)
		return false
	}
} 

ONE.browser_boot_()