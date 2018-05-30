/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

var localConnection;
var remoteConnection;
var sendChannel;
var receiveChannel;
var megsToSend = document.querySelector('input#megsToSend');
var sendButton = document.querySelector('button#sendTheData');
var orderedCheckbox = document.querySelector('input#ordered');
var sendProgress = document.querySelector('progress#sendProgress');
var receiveProgress = document.querySelector('progress#receiveProgress');
var errorMessage = document.querySelector('div#errorMsg');

var receivedSize = 0;
var bytesToSend = 0;

sendButton.onclick = createConnection;

// Prevent data sent to be set to 0.
megsToSend.addEventListener('change', function (e) {
  if (this.value <= 0) {
    sendButton.disabled = true;
    errorMessage.innerHTML = '<p>Please enter a number greater than zero.</p>';
  } else {
    errorMessage.innerHTML = '';
    sendButton.disabled = false;
  }
});

function createConnection() {
  sendButton.disabled = true;
  megsToSend.disabled = true;
  var servers = null;

  bytesToSend = Math.round(megsToSend.value) * 1024 * 1024;

  localConnection = new RTCPeerConnection(servers);
  trace('Created local peer connection object localConnection');

  var dataChannelParams = { ordered: false };
  if (orderedCheckbox.checked) {
    dataChannelParams.ordered = true;
  }

  sendChannel = localConnection.createDataChannel(
    'sendDataChannel', dataChannelParams);
  sendChannel.binaryType = 'arraybuffer';
  trace('Created send data channel');

  sendChannel.onopen = onSendChannelStateChange;
  sendChannel.onclose = onSendChannelStateChange;
  localConnection.onicecandidate = function (e) {
    onIceCandidate(localConnection, e);
  };

  localConnection.createOffer().then(
    gotDescription1,
    onCreateSessionDescriptionError
  );

  remoteConnection = remoteConnection = new RTCPeerConnection(servers);
  trace('Created remote peer connection object remoteConnection');

  remoteConnection.onicecandidate = function (e) {
    onIceCandidate(remoteConnection, e);
  };
  remoteConnection.ondatachannel = receiveChannelCallback;
}

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

function closeDataChannels() {
  trace('Closing data channels');
  sendChannel.close();
  trace('Closed data channel with label: ' + sendChannel.label);
  receiveChannel.close();
  trace('Closed data channel with label: ' + receiveChannel.label);
  localConnection.close();
  remoteConnection.close();
  localConnection = null;
  remoteConnection = null;
  trace('Closed peer connections');
}

function gotDescription1(desc) {
  localConnection.setLocalDescription(desc);
  trace('Offer from localConnection \n' + desc.sdp);
  remoteConnection.setRemoteDescription(desc);
  remoteConnection.createAnswer().then(
    gotDescription2,
    onCreateSessionDescriptionError
  );
}

function gotDescription2(desc) {
  remoteConnection.setLocalDescription(desc);
  trace('Answer from remoteConnection \n' + desc.sdp);
  localConnection.setRemoteDescription(desc);
}

function getOtherPc(pc) {
  return (pc === localConnection) ? remoteConnection : localConnection;
}

function getName(pc) {
  return (pc === localConnection) ? 'localPeerConnection' :
    'remotePeerConnection';
}

function onIceCandidate(pc, event) {
  getOtherPc(pc).addIceCandidate(event.candidate)
    .then(
      function () {
        onAddIceCandidateSuccess(pc);
      },
      function (err) {
        onAddIceCandidateError(pc, err);
      }
    );
  trace(getName(pc) + ' ICE candidate: \n' + (event.candidate ?
    event.candidate.candidate : '(null)'));
}

function onAddIceCandidateSuccess() {
  trace('AddIceCandidate success.');
}

function onAddIceCandidateError(error) {
  trace('Failed to add Ice Candidate: ' + error.toString());
}

function receiveChannelCallback(event) {
  trace('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.binaryType = 'arraybuffer';
  receiveChannel.onmessage = onReceiveMessageCallback;

  receivedSize = 0;
}

function onReceiveMessageCallback(event) {
  receivedSize += event.data.length;
  receiveProgress.value = receivedSize;
  //trace(`Received ${event.data}`);
  let pathData = event.data.split(',').map(val => Number.parseInt(val));
  const outputCanvas = document.querySelector('canvas#outputCanvas');
  drawPath(outputCanvas, pathData)  

  if (receivedSize === bytesToSend) {
    closeDataChannels();
    sendButton.disabled = false;
    megsToSend.disabled = false;
  }
}

function onSendChannelStateChange() {
  var readyState = sendChannel.readyState;
  trace('Send channel state is: ' + readyState);
  if (readyState === 'open') {
    //    sendGeneratedData();
  }
}

function getMousePos(evt) {
  const canvas = evt.target;
  const rect = canvas.getBoundingClientRect(),
    scaleX = canvas.width / rect.width,
    scaleY = canvas.height / rect.height;  // relationship bitmap vs. element for Y

  return {
    x: Number.parseInt((evt.clientX - rect.left) * scaleX),
    y: Number.parseInt((evt.clientY - rect.top) * scaleY)
  }
}

let mouseData = Array();
function mouseDown(e) {
  let pos = getMousePos(e);
  mouseData.push(pos.x, pos.y);
  trace(`mouesDown ${pos.x}, ${pos.y}`)
}

function mouseUp(e) {
  if (mouseData.length == 0) return;
  let pos = getMousePos(e);
  mouseData.push(pos.x, pos.y);
  trace(`mouesUp ${pos.x}. ${pos.y}`);
  trace(`Path: ${mouseData.length}`);
  sendChannel.send(mouseData.join())
  mouseData = Array();
}

function mouseMove(e) {
  if (mouseData.length == 0) return;
  let pos = getMousePos(e);
  mouseData.push(pos.x, pos.y);
  trace(`mouesMove ${pos.x}, ${pos.y}`);
  const inputCanvas = document.querySelector('canvas#inputCanvas');
  drawPath(inputCanvas, mouseData.slice(-4));
}

function drawPath(canvas, points) {
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) {
    ctx.lineTo(points[i], points[i + 1]);
  }
  ctx.stroke();

}

function initCanvas() {
  const inputCanvas = document.querySelector('canvas#inputCanvas')
  //  var outputCanvas = document.querySelector('canvas#output')
  inputCanvas.addEventListener('mousedown', mouseDown);
  inputCanvas.addEventListener('mouseup', mouseUp);
  inputCanvas.addEventListener('mousemove', mouseMove);
}

(function () {
  initCanvas();
  createConnection();
})()