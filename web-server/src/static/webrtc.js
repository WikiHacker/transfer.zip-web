const RTC_CONF = {
	iceServers: [
		{ urls: "stun:stun.l.google.com:19302" },
		{ urls: "stun:stun1.l.google.com:19302" },
		{ urls: "stun:stun2.l.google.com:19302" },
		{ urls: "stun:stun3.l.google.com:19302" },
		{ urls: "stun:stun4.l.google.com:19302" },
		{ urls: "stun:stun01.sipphone.com" },
		{ urls: "stun:stun.ekiga.net" },
		{ urls: "stun:stun.fwdnet.net" },
		{ urls: "stun:stun.ideasip.com" },
		{ urls: "stun:stun.iptel.org" },
		{ urls: "stun:stun.rixtelecom.se" },
		{ urls: "stun:stun.schlund.de" },
		{ urls: "stun:stunserver.org" },
		{ urls: "stun:stun.softjoys.com" },
		{ urls: "stun:stun.voiparound.com" },
		{ urls: "stun:stun.voipbuster.com" },
		{ urls: "stun:stun.voipstunt.com" },
		{ urls: "stun:stun.voxgratia.org" },
		{ urls: "stun:stun.xten.com" }
	]
}

const WS_URL = (window.location.protocol.includes("s") ? "wss://" : "ws://") + window.location.host + "/ws"

/**
 * List containing all RtcSession instances
 */
let activeRtcSessions = []

const newRtcSession = (sessionId) => {
	closeAndRemoveRtcSessionById(sessionId)
	const rtcSession = new RtcSession(sessionId)
	activeRtcSessions.push(rtcSession)
	return rtcSession
}

const closeAndRemoveRtcSessionById = (sessionId) => {
	const rtcSession = activeRtcSessions.find((o => o.sessionId == sessionId))
	if(rtcSession) {
		rtcSession.close()
		removeRtcSession(rtcSession)
	}
}

const removeRtcSession = (rtcSession) => {
	activeRtcSessions = activeRtcSessions.filter(o => o !== rtcSession)
}

const ws = new WebSocket(WS_URL)
	
let keepAliveIntervalId = undefined
	
ws.addEventListener("error", async e => {
	clearInterval(keepAliveIntervalId)
	throw "WebSocket error: could not connect to server"
})
		
ws.addEventListener("open", e => {
	console.log("Signalling open")

	keepAliveIntervalId = setInterval(() => {
		ws.send(".")
	}, 30000)

	for(let rtcSession of activeRtcSessions) {
		rtcSession.onopen && rtcSession.onopen()
	}
})

ws.addEventListener("message", e => {
	const data = JSON.parse(e.data)
	console.debug(data)
	if(data.targetId == undefined) {
		console.warn("targetId not specified: ", data)
		return
	}
	for(let rtcSession of activeRtcSessions) {
		if (rtcSession.sessionId === data.targetId) {
			rtcSession.onmessage && rtcSession.onmessage(data)
		}
	}
})

class RtcSession {
	onopen = undefined
	onmessage = undefined

	constructor(sessionId) {
		this.sessionId = sessionId
	}

	async _recv() {
		console.log("rtcRecv")
		const peerConnection = new RTCPeerConnection(RTC_CONF);

		ws.send(JSON.stringify({
			type: 0,
			id: this.sessionId
		}))
	
		let recipientId;
	
		peerConnection.addEventListener("icecandidate", e => {
			console.debug(e)
			if (e.candidate) {
				console.log("peerConnection Got ICE candidate:", e.candidate)
				ws.send(JSON.stringify({
					type: 3, sessionId: this.sessionId, candidate: e.candidate, recipientId
				}))
			}
		})

		this.onmessage = async data => {
			if (data.type == 11 && data.offer) {
				console.log("Got offer:", data.offer)
				peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
				const answer = await peerConnection.createAnswer();
				await peerConnection.setLocalDescription(answer);
				console.log("Sending answer:", answer)
				recipientId = data.callerId
				ws.send(JSON.stringify({
					type: 2, sessionId: this.sessionId, answer, recipientId
				}));
			}
			else if (data.type == 13 && data.candidate) {
				console.log("Got candidate:", data.candidate)
				await peerConnection.addIceCandidate(data.candidate)
			}
		}
	
		let iceconnectionstatechangeListener = peerConnection.addEventListener("iceconnectionstatechange", async e => {
			console.log("RECV iceconnectionstatechange", e)
			if(e.target.connectionState == "connected") {
				peerConnection.removeEventListener("iceconnectionstatechange", iceconnectionstatechangeListener)
				return
			}
			else if(e.target.connectionState == "disconnected") {
				throw "Remote peer disconnected"
			}
			else if(e.target.connectionState == "failed") {
				throw "Could not connect to remote peer, check your firewall settings or try connecting to another network"
			}
		})
	
		return new Promise((resolve, reject) => {
			peerConnection.addEventListener("datachannel", e => {
				const channel = e.channel
				console.log("Got datachannel!", channel)
				channel.binaryType = "arraybuffer"
				resolve(channel)
			})
		})
	}

	async _call(recipientId) {
		console.log("rtcCall")
		const peerConnection = new RTCPeerConnection(RTC_CONF);

		ws.send(JSON.stringify({
			type: 0,
			id: this.sessionId
		}))
	
		peerConnection.addEventListener("icecandidate", e => {
			console.log(e)
			if (e.candidate) {
				console.log("peerConnection Got ICE candidate:", e.candidate)
				ws.send(JSON.stringify({
					type: 3, candidate: e.candidate, recipientId
				}))
			}
		})
	
		/*
		* Apparently, now when not waiting for ws.open anymore, data channel needs to be
		* created before peerConnection.setLocalDescription is called. 
		* This took too many ******* hours to figure out. I really ******* hate programming.
		*/

		let sendChannel = peerConnection.createDataChannel("sendDataChannel")
		sendChannel.binaryType = "arraybuffer"
	
		this.onmessage = async data => {
			if (data.type == 12 && data.answer) {
				console.log("Got answer:", data.answer)
				const remoteDesc = data.answer;
				await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc));
			}
			else if (data.type == 13 && data.candidate) {
				console.log("Got candidate:", data.candidate)
				await peerConnection.addIceCandidate(data.candidate)
			}
			else {
				if(!data.success) {
					throw data.msg
				}
			}
		}
	
		let iceconnectionstatechangeListener = peerConnection.addEventListener("iceconnectionstatechange", async e => {
			console.log("CALL iceconnectionstatechange", e)
			if(e.target.connectionState == "connected") {
				peerConnection.removeEventListener("iceconnectionstatechange", iceconnectionstatechangeListener)
				return
			}
			else if(e.target.connectionState == "disconnected") {
				throw "Remote peer disconnected"
			}
			else if(e.target.connectionState == "failed") {
				throw "Could not connect to remote peer, check your firewall settings or try connecting to another network"
			}
		})

		const offer = await peerConnection.createOffer();
		await peerConnection.setLocalDescription(offer);
		console.log("Sending offer:", offer)
		ws.send(JSON.stringify({
			type: 1, offer, recipientId, callerId: this.sessionId
		}));
	
		return new Promise((resolve, reject) => {
			sendChannel.addEventListener("open", e => {
				console.log("datachannel open", e)
				resolve(sendChannel)
			})
	
			sendChannel.addEventListener("close", e => {
				console.log("datachannel close", e)
				reject(new Error("Data channel closed"))
			})
	
			sendChannel.addEventListener("error", e => {
				console.log("datachannel error", e)
				reject(e)
			})
		})
	}

	async waitForWebsocket() {
		if(ws.readyState == WebSocket.OPEN) {
			return
		}
		else {
			return new Promise((resolve, reject) => {
				this.onopen = async () => {
					resolve()
				}
			})
		}
	}

	async recv() {
		await this.waitForWebsocket()
		return this._recv()
	}
	
	async call(recipientId) {
		await this.waitForWebsocket()
		return this._call(recipientId)
	}

	close() {
		ws.send(JSON.stringify({
			type: 4, sessionId: this.sessionId
		}))
	}

}

