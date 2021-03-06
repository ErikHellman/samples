/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* global TimelineDataSeries, TimelineGraphView */

'use strict';

const remoteVideo = document.querySelector('video#remoteVideo');
const localVideo = document.querySelector('video#localVideo');
const callButton = document.querySelector('button#callButton');
const hangupButton = document.querySelector('button#hangupButton');
const bandwidthSelector = document.querySelector('select#bandwidth');
hangupButton.disabled = true;
callButton.onclick = call;
hangupButton.onclick = hangup;

let pc1;
let pc2;
let localStream;

let bitrateGraph;
let bitrateSeries;

let packetGraph;
let packetSeries;

let lastResult;

const offerOptions = {
  offerToReceiveAudio: 0,
  offerToReceiveVideo: 1
};

function gotStream(stream) {
  hangupButton.disabled = false;
  trace('Received local stream');
  localStream = stream;
  localVideo.srcObject = stream;
  localStream.getTracks().forEach(
    track => {
      pc1.addTrack(
        track,
        localStream
      );
    }
  );
  trace('Adding Local Stream to peer connection');

  pc1.createOffer(
    offerOptions
  ).then(
    gotDescription1,
    onCreateSessionDescriptionError
  );

  bitrateSeries = new TimelineDataSeries();
  bitrateGraph = new TimelineGraphView('bitrateGraph', 'bitrateCanvas');
  bitrateGraph.updateEndDate();

  packetSeries = new TimelineDataSeries();
  packetGraph = new TimelineGraphView('packetGraph', 'packetCanvas');
  packetGraph.updateEndDate();
}

function onCreateSessionDescriptionError(error) {
  trace(`Failed to create session description: ${error.toString()}`);
}

function call() {
  callButton.disabled = true;
  bandwidthSelector.disabled = false;
  trace('Starting call');
  const servers = null;
  pc1 = new RTCPeerConnection(servers);
  trace('Created local peer connection object pc1');
  pc1.onicecandidate = onIceCandidate.bind(pc1);

  pc2 = new RTCPeerConnection(servers);
  trace('Created remote peer connection object pc2');
  pc2.onicecandidate = onIceCandidate.bind(pc2);
  pc2.ontrack = gotRemoteStream;

  trace('Requesting local stream');
  navigator.mediaDevices.getUserMedia({
    video: true
  })
  .then(gotStream)
  .catch(e => {
    alert(`getUserMedia() error: ${e.name}`);
  });
}

function gotDescription1(desc) {
  trace(`Offer from pc1 \n${desc.sdp}`);
  pc1.setLocalDescription(desc).then(
    () => {
      pc2.setRemoteDescription(desc).then(
        () => {
          pc2.createAnswer().then(
            gotDescription2,
            onCreateSessionDescriptionError
          );
        },
        onSetSessionDescriptionError
      );
    },
    onSetSessionDescriptionError
  );
}

function gotDescription2(desc) {
  pc2.setLocalDescription(desc).then(
    () => {
      trace(`Answer from pc2 \n${desc.sdp}`);
      pc1.setRemoteDescription({
        type: desc.type,
        sdp: updateBandwidthRestriction(desc.sdp, '500')
      }).then(
        () => {
        },
        onSetSessionDescriptionError
      );
    },
    onSetSessionDescriptionError
  );
}

function hangup() {
  trace('Ending call');
  localStream.getTracks().forEach(track => {
    track.stop();
  });
  pc1.close();
  pc2.close();
  pc1 = null;
  pc2 = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
  bandwidthSelector.disabled = true;
}

function gotRemoteStream(e) {
  if (remoteVideo.srcObject !== e.streams[0]) {
    remoteVideo.srcObject = e.streams[0];
    trace('Received remote stream');
  }
}

function getOtherPc(pc) {
  return pc === pc1 ? pc2 : pc1;
}

function getName(pc) {
  return pc === pc1 ? 'pc1' : 'pc2';
}

function onIceCandidate(event) {
  getOtherPc(this)
  .addIceCandidate(event.candidate)
  .then(onAddIceCandidateSuccess)
  .catch(onAddIceCandidateError);

  trace(`${getName(this)} ICE candidate: \n${event.candidate ?
    event.candidate.candidate : '(null)'}`);
}

function onAddIceCandidateSuccess() {
  trace('AddIceCandidate success.');
}

function onAddIceCandidateError(error) {
  trace(`Failed to add ICE Candidate: ${error.toString()}`);
}

function onSetSessionDescriptionError(error) {
  trace(`Failed to set session description: ${error.toString()}`);
}

// renegotiate bandwidth on the fly.
bandwidthSelector.onchange = () => {
  bandwidthSelector.disabled = true;
  const bandwidth = bandwidthSelector.options[bandwidthSelector.selectedIndex]
      .value;
  pc1.createOffer()
  .then(offer => pc1.setLocalDescription(offer))
  .then(() => {
    const desc = {
      type: pc1.remoteDescription.type,
      sdp: bandwidth === 'unlimited'
          ? removeBandwidthRestriction(pc1.remoteDescription.sdp)
          : updateBandwidthRestriction(pc1.remoteDescription.sdp, bandwidth)
    };
    trace(`Applying bandwidth restriction to setRemoteDescription:\n${desc.sdp}`);
    return pc1.setRemoteDescription(desc);
  })
  .then(() => {
    bandwidthSelector.disabled = false;
  })
  .catch(onSetSessionDescriptionError);
};

function updateBandwidthRestriction(sdp, bandwidth) {
  let modifier = 'AS';
  if (adapter.browserDetails.browser === 'firefox') {
    bandwidth = (bandwidth >>> 0) * 1000;
    modifier = 'TIAS';
  }
  if (sdp.indexOf(`b=${modifier}:`) === -1) {
    // insert b= after c= line.
    sdp = sdp.replace(/c=IN (.*)\r\n/,
        `c=IN $1\r\nb=${modifier}:${bandwidth}\r\n`);
  } else {
    sdp = sdp.replace(new RegExp(`b=${modifier}:.*\r\n`),
        `b=${modifier}:${bandwidth}\r\n`);
  }
  return sdp;
}

function removeBandwidthRestriction(sdp) {
  return sdp.replace(/b=AS:.*\r\n/, '').replace(/b=TIAS:.*\r\n/, '');
}

// query getStats every second
window.setInterval(() => {
  if (!window.pc1) {
    return;
  }
  window.pc1.getStats(null).then(res => {
    res.forEach(report => {
      let bytes;
      let packets;
      const now = report.timestamp;
      if (report.type === 'outbound-rtp') {
        bytes = report.bytesSent;
        packets = report.packetsSent;
        if (lastResult && lastResult.get(report.id)) {
          // calculate bitrate
          const bitrate = 8 * (bytes - lastResult.get(report.id).bytesSent) /
              (now - lastResult.get(report.id).timestamp);

          // append to chart
          bitrateSeries.addPoint(now, bitrate);
          bitrateGraph.setDataSeries([bitrateSeries]);
          bitrateGraph.updateEndDate();

          // calculate number of packets and append to chart
          packetSeries.addPoint(now, packets -
              lastResult.get(report.id).packetsSent);
          packetGraph.setDataSeries([packetSeries]);
          packetGraph.updateEndDate();
        }
      }
    });
    lastResult = res;
  });
}, 1000);
