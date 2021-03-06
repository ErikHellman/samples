/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

const callButton = document.querySelector('button#callButton');
const sendTonesButton = document.querySelector('button#sendTonesButton');
const hangupButton = document.querySelector('button#hangupButton');

sendTonesButton.disabled = true;
hangupButton.disabled = true;

callButton.onclick = call;
sendTonesButton.onclick = handleSendTonesClick;
hangupButton.onclick = hangup;

const durationInput = document.querySelector('input#duration');
const gapInput = document.querySelector('input#gap');
const tonesInput = document.querySelector('input#tones');

const durationValue = document.querySelector('span#durationValue');
const gapValue = document.querySelector('span#gapValue');

const sentTonesDiv = document.querySelector('div#sentTones');
const dtmfStatusDiv = document.querySelector('div#dtmfStatus');

const audio = document.querySelector('audio');

let pc1;
let pc2;
let localStream;
let dtmfSender;

const offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 0
};

durationInput.oninput = () => {
  durationValue.textContent = durationInput.value;
};

gapInput.oninput = () => {
  gapValue.textContent = gapInput.value;
};

main();

function main() {
  addDialPadHandlers();
}

function gotStream(stream) {
  trace('Received local stream');
  localStream = stream;
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length > 0) {
    trace(`Using Audio device: ${audioTracks[0].label}`);
  }
  if (adapter.browserDetails.browser !== 'chrome' ||
      adapter.browserDetails.version >= 66) {
    localStream.getTracks().forEach(
      track => {
        pc1.addTrack(
          track,
          localStream
        );
      }
    );
  } else {
    // TODO: https://github.com/webrtc/adapter/issues/733
    // chrome does not yet support addTrack + dtmf until M66.
    pc1.addStream(localStream);
  }
  trace('Adding Local Stream to peer connection');
  pc1.createOffer(
    offerOptions
  ).then(
    gotDescription1,
    onCreateSessionDescriptionError
  );
}

function onCreateSessionDescriptionError(error) {
  trace(`Failed to create session description: ${error.toString()}`);
}

function call() {
  trace('Starting call');
  const servers = null;
  pc1 = new RTCPeerConnection(servers);
  trace('Created local peer connection object pc1');
  pc1.onicecandidate = e => {
    onIceCandidate(pc1, e);
  };
  pc2 = new RTCPeerConnection(servers);
  trace('Created remote peer connection object pc2');
  pc2.onicecandidate = e => {
    onIceCandidate(pc2, e);
  };
  pc2.ontrack = gotRemoteStream;

  trace('Requesting local stream');
  navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false
  })
  .then(gotStream)
  .catch(e => {
    alert(`getUserMedia() error: ${e.name}`);
  });

  callButton.disabled = true;
  hangupButton.disabled = false;
  sendTonesButton.disabled = false;
}

function gotDescription1(desc) {
  pc1.setLocalDescription(desc);
  trace(`Offer from pc1 \n${desc.sdp}`);
  pc2.setRemoteDescription(desc);
  // Since the 'remote' side has no media stream we need
  // to pass in the right constraints in order for it to
  // accept the incoming offer of audio.
  pc2.createAnswer().then(
    gotDescription2,
    onCreateSessionDescriptionError
  );
}

function gotDescription2(desc) {
  pc2.setLocalDescription(desc);
  trace(`Answer from pc2: \n${desc.sdp}`);
  pc1.setRemoteDescription(desc);
}

function hangup() {
  trace('Ending call');
  pc1.close();
  pc2.close();
  pc1 = null;
  pc2 = null;
  localStream = null;
  dtmfSender = null;
  callButton.disabled = false;
  hangupButton.disabled = true;
  sendTonesButton.disabled = true;
  dtmfStatusDiv.textContent = 'DTMF deactivated';
}

function gotRemoteStream(e) {
  if (audio.srcObject !== e.streams[0]) {
    audio.srcObject = e.streams[0];
    trace('Received remote stream');

    if (!pc1.getSenders) {
      alert('This demo requires the RTCPeerConnection method getSenders() ' +
            'which is not support by this browser.');
      return;
    }
    const senders = pc1.getSenders();
    const audioSender = senders.find(sender => sender.track && sender.track.kind === 'audio');
    if (!audioSender) {
      trace('No local audio track to send DTMF with\n');
      return;
    }
    if (!audioSender.dtmf) {
      alert('This demo requires DTMF which is not support by this browser.');
      return;
    }
    dtmfSender = audioSender.dtmf;
    dtmfStatusDiv.textContent = 'DTMF available';
    trace('Got DTMFSender\n');
    dtmfSender.ontonechange = dtmfOnToneChange;
  }
}

function getOtherPc(pc) {
  return (pc === pc1) ? pc2 : pc1;
}

function getName(pc) {
  return (pc === pc1) ? 'pc1' : 'pc2';
}

function onIceCandidate(pc, event) {
  getOtherPc(pc).addIceCandidate(event.candidate)
  .then(
    () => {
      onAddIceCandidateSuccess(pc);
    },
    err => {
      onAddIceCandidateError(pc, err);
    }
  );
  trace(`${getName(pc)} ICE candidate: \n${event.candidate ?
    event.candidate.candidate : '(null)'}`);
}

function onAddIceCandidateSuccess() {
  trace('AddIceCandidate success');
}

function onAddIceCandidateError(error) {
  trace(`Failed to add Ice Candidate: ${error.toString()}`);
}

function dtmfOnToneChange(tone) {
  if (tone) {
    trace(`Sent DTMF tone: ${tone.tone}`);
    sentTonesDiv.textContent += `${tone.tone} `;
  }
}

function sendTones(tones) {
  if (dtmfSender) {
    const duration = durationInput.value;
    const gap = gapInput.value;
    console.log('Tones, duration, gap: ', tones, duration, gap);
    dtmfSender.insertDTMF(tones, duration, gap);
  }
}

function handleSendTonesClick() {
  sendTones(tonesInput.value);
}

function addDialPadHandlers() {
  const dialPad = document.querySelector('div#dialPad');
  const buttons = dialPad.querySelectorAll('button');
  for (let i = 0; i !== buttons.length; ++i) {
    buttons[i].onclick = sendDtmfTone;
  }
}

function sendDtmfTone() {
  sendTones(this.textContent);
}
