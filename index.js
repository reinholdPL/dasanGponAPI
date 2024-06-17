#!/bin/env node

const fs = require('fs');
const pty = require('node-pty');
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

const credentials = require('./credentials.json');
const config = require('./config.json');

// console.log(credentials);

function GponSession(host) {

    if (credentials.hosts[host] === undefined) {
        console.log(`no credentials for ${host}`);
        return null;
    }

    this.processingBuffer = "";
    this.loggedInto = false;
    this.host = host;
    this.port = credentials.hosts[host].port ? credentials.hosts[host].port : 22;
    this.username = credentials.hosts[host].username ? credentials.hosts[host].username : "admin";
    this.password = credentials.hosts[host].password;
    this.hostname = null;

    console.log(`host = ${this.host}, port = ${this.port}, username = ${this.username}, password = ${this.password}`);

    this.isCmdTaken = true; // false if IDLE
    // let currentMode = 0; // 0- NORMAL 1- ENABLED 2- CONF TERM

    this.ptyProcess = pty.spawn('/usr/bin/ssh', ['-p' + this.port, this.username + '@' + this.host], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME,
        env: process.env
    });

    this.gponObject = {};

    this.ptyProcess.onData((data) => {
        // process.stdout.write(data);
        this.processingBuffer += data;
        this.processBuffer();
    });

    this.ptyProcess.onExit(() => {
        readline.close();
        console.log("ptyProcess exit");
        clearInterval(this.idleInterval);
    });

    this.runningCmd = false;
    this.cmdCallback = null;
    this.cmdName = null;

    function convertToRangeArray(input) {
        // Split the input string by commas to get individual elements
        let elements = input.split(',');
        let result = [];

        elements.forEach(element => {
            // Check if the element contains a hyphen, indicating a range
            if (element.includes('-')) {
                // Split the range into start and end
                let [start, end] = element.split('-').map(Number);
                // Add all numbers in the range to the result array
                for (let i = start; i <= end; i++) {
                    result.push(i);
                }
            } else {
                // If it's a single number, add it directly to the result array
                result.push(Number(element));
            }
        });

        return result;
    }

    this.parseGponCmd = (gponObject, line) => {
        // console.log(`parsing: ${line}`);

        let test;
        if (test = line.match(/hostname\s+(?<hostname>[\x00-\x7F]+)/)) {
            gponObject.hostname = test.groups.hostname;
            return;
        }

        if (line === "bridge") {
            gponObject.currentMode = "bridge";
            return;
        }

        if (gponObject.currentMode === "bridge") {

            if (test = line.match(/vlan create\s+(?<vlanList>[\x00-\x7F]+)/)) {
                let rangeArray = convertToRangeArray(test.groups.vlanList);
                for (let vid of rangeArray) {
                    // console.log(vid);
                    gponObject.vlan.byVID[vid] = {
                        untagged: [],
                        tagged: []
                    };
                }
                return;
            }

            if (test = line.match(/vlan add\s+(?<vlanList>[\x00-\x7F]+)\s+(?<portList>[\x00-\x7F]+)\s+(?<tagType>[\x00-\x7F]+)/)) {
                let groups = JSON.parse(JSON.stringify(test.groups));
                groups.vlanList = convertToRangeArray(groups.vlanList.replace("br", "").replace("default", "1"));
                groups.portList = convertToRangeArray(groups.portList);

                // console.log(groups);

                for (let vid of groups.vlanList) {
                    for (let port of groups.portList) {
                        gponObject.vlan.byVID[vid][groups.tagType].push(port);

                        if (gponObject.ports[port] === undefined) {
                            gponObject.ports[port] = {
                                untagged: [],
                                tagged: []
                            }
                        }

                        gponObject.ports[port][groups.tagType].push(vid);
                    }
                }
                // let rangeArray = convertToRangeArray(test.groups.vlanList);
                // for (let vid of rangeArray) {
                //     // console.log(vid);
                //     gponObject.vlan.byVID[vid] = {};
                // }

                return;
            }


            if (test = line.match(/vlan pvid\s+(?<portList>[\x00-\x7F]+)\s+(?<vid>[\x00-\x7F]+)/)) {
                let groups = JSON.parse(JSON.stringify(test.groups));
                //groups.vlanList = convertToRangeArray(groups.vlanList.replace("br", "").replace("default", "1"));
                groups.portList = convertToRangeArray(groups.portList);

                for (let port of groups.portList) {
                    if (gponObject.ports[port] === undefined) {
                        gponObject.ports[port] = {
                            untagged: [],
                            tagged: []
                        }
                    }
                    gponObject.ports[port].pvid = groups.vid;
                }
            }

            if (test = line.match(/vlan description\s+(?<vlanList>[\x00-\x7F]+)\s+(?<vlanName>[\x00-\x7F]+)/)) {
                let groups = JSON.parse(JSON.stringify(test.groups));
                groups.vlanList = convertToRangeArray(groups.vlanList.replace("br", "").replace("default", "1"));
                // groups.vlanName = convertToRangeArray(groups.vlanName);

                for (let vid of groups.vlanList) {
                    gponObject.vlan.byVID[vid].description = groups.vlanName;
                    if (gponObject.vlan.byName[groups.vlanName] === undefined) {
                        gponObject.vlan.byName[groups.vlanName] = [];
                    }

                    gponObject.vlan.byName[groups.vlanName].push(vid);

                }
            }

            if (test = line.match(/port description\s+(?<portList>[0-9-,]+)\s+(?<portDescription>[\x00-\x7F ]+)/)) {
                let groups = JSON.parse(JSON.stringify(test.groups));
                groups.portList = convertToRangeArray(groups.portList);

                for (let port of groups.portList) {
                    if (gponObject.ports[port] === undefined) {
                        gponObject.ports[port] = {
                            untagged: [],
                            tagged: []
                        }
                    }
                    gponObject.ports[port].description = groups.portDescription;
                }
            }
        }
    }

    this.parseRunningConfig = (textConfig) => {
        console.log(`-->parse running config`);
        let lines = textConfig.split("\r\n").map(line => line.trim()).filter((line => line !== '!' && line.length > 0));
        this.gponObject = {
            vlan: {
                byVID: {
                    1: {
                        untagged: [],
                        tagged: []
                    }
                },
                byName: {},
            },
            ports: {

            }
        };

        for (let line of lines) {
            this.parseGponCmd(this.gponObject, line);
        }
        // console.log(JSON.stringify(this.gponObject, null, 1));
    }

    this.parseShowOnuDetailInfo = (onuDetailInfo) => {
        console.log(` --> parse show onu detail info`);
        let lines = onuDetailInfo.split("\r\n");
        this.gponOnuData = {};
        let currentOLT;
        let currentONU;
        for (let line of lines) {
            let test;

            if (line.replace(/-+/, "").trim() === '') continue;

            if (test = line.match(/OLT : (?<olt_id>[0-9]+), ONU : (?<onu_id>[0-9]+)/)) {
                currentOLT = parseInt(test.groups.olt_id);
                currentONU = parseInt(test.groups.onu_id);
                // console.log(`OLT: ${currentOLT}, ONU: ${currentONU}`);
                if (this.gponOnuData[currentOLT] === undefined) {
                    this.gponOnuData[currentOLT] = {};
                }

                if (this.gponOnuData[currentOLT][currentONU] === undefined) {
                    this.gponOnuData[currentOLT][currentONU] = {};
                }
            } else {

                let splitted = line.split(": ");
                if (splitted.length < 2) continue;
                let keyName = splitted[0].trim().replace(/[-\/\(\)]/g, " ");
                // convert keyName to camelCase
                keyName = keyName.replace(/_([a-z])/g, function(g) {
                    return g[1].toUpperCase();
                }).replace(/ /g, "");
                // first letter to lowercase
                keyName = keyName.charAt(0).toLowerCase() + keyName.slice(1);

                let value = splitted[1].trim();
                this.gponOnuData[currentOLT][currentONU][keyName] = value;
                // console.log();

                // activated_time: '32:17:45:32' - "days:hours:minutes:seconds"
                // convert activated_time to seconds

                if (keyName === "activatedTime" || keyName === "inactiveTime") {
                    let timeParts = value.split(":");
                    let days = parseInt(timeParts[0]);
                    let hours = parseInt(timeParts[1]);
                    let minutes = parseInt(timeParts[2]);
                    let seconds = parseInt(timeParts[3]);

                    let totalSeconds = days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60 + seconds;
                    this.gponOnuData[currentOLT][currentONU][`${keyName}_seconds`] = totalSeconds;
                }
            }
        }

        // console.log(this.gponOnuData);
    }


    this.currentMode = {};

    this.runNextCmd = () => {
        if (this.commandsList.length > 0) {
            this.isCmdTaken = true;
            let cmd = this.commandsList.shift();

            // console.log(cmd);

            this.runCmd(cmd[0], cmd[1]);
        } else {
            // no cmd in queue
            console.log("--> no next cmd in queue, going IDLE");
            this.isCmdTaken = false;
        }
    }

    this.runCmd = (cmd, callback) => {
        if (this.runningCmd) {
            //cmd already running!
            this.commandsList.push([cmd, callback]);
        } else {
            console.log(`running command = ${cmd}, callback = ${typeof callback === "function"? "yes" : "no"}`);
            this.cmdName = cmd;
            this.cmdCallback = callback;
            this.runningCmd = true;
            this.ptyProcess.write(cmd + "\r");
        }
    }

    this.cmdDone = (fncResult) => {
        if (typeof this.cmdCallback === "function") {
            console.log(`got cmd callback!`);
            this.cmdCallback(fncResult);
        } else {
            // console.log(`no callback for cmd = ${this.cmdName}, typeof calblack is ${typeof this.cmdCallback}`);
        }


        runningCmd = false;
    }

    this.processBuffer = () => {
        // "admin@10.1.3.203's password:"
        if (this.loggedInto === false) {

            let passwordPromptPosition = this.processingBuffer.match(/admin@[0-9.']+s password:/);
            // console.log(passwordPromptPosition);

            if (passwordPromptPosition !== null) {
                this.processingBuffer = this.processingBuffer.substring(
                    passwordPromptPosition.index + passwordPromptPosition[0].length);
                console.log("\n----> got password prompt, sending password");
                // console.log("is now : " +processingBuffer );
                //logujemy
                this.ptyProcess.write(`${this.password}\r`);
                this.loggedInto = true;
            }

            return;
        }

        if (this.hostname === null) {
            // console.log("processing buffer = " + processingBuffer);

            let test = this.processingBuffer.match(/(?<hostname>[A-Za-z]+)>/);
            if (test) {
                this.processingBuffer = this.processingBuffer.substring(
                    test.index + test[0].length);

                // console.log(test);
                this.hostname = test.groups.hostname;
                console.log(`hostname is = ${this.hostname}`);

                this.runNextCmd();
            }

            return;
        }

        let promptMatch = /\n(?<hostname>[A-Za-z]+)(?<submode>[A-Za-z()-\[\]]{0,})(?<mode>[>#])/;
        let test = this.processingBuffer.match(promptMatch);

        if (test) {
            // console.log("----> prompt found!");

            this.currentMode = JSON.parse(JSON.stringify(test.groups));
            this.currentMode.lastPrompt = test[0].trim();
            console.log(this.currentMode);

            let funcResult = this.processingBuffer.substring(0,
                test.index + 1);

            this.processingBuffer = this.processingBuffer.substring(
                test.index + test[0].length);

            this.cmdDone(funcResult);

            this.runningCmd = false;
            this.runNextCmd();
        }

        //jesteśmy zalogowani i mamy hostname
        // ptyProcess.write(`exit\r`);
    }

    this.commandsList = [
        ["enable", null],
        ["terminal length 0"],
        ["show running-config", this.parseRunningConfig],
        ["conf term"],
        ["show onu detail-info", this.parseShowOnuDetailInfo],
        // ["exit"],
        ["exit"]
    ];

    // console.log(`this.parseShowOnuDetailInfo = ${this.parseShowOnuDetailInfo}`);

    // ptyProcess.write('ls\r');
    // ptyProcess.resize(100, 40);
    // ptyProcess.write('ls\r');

    this.idleInterval = setInterval(() => {
        if (this.isCmdTaken === false) { //is idle?
            console.log((new Date()).toLocaleTimeString() + `--> pushing IDLE command to queue`);
            this.commandsList.push([""]);
            this.runNextCmd();
        }

    }, 10000);
}

let gponSession = new GponSession("10.1.3.203");
if (gponSession === null) {
    console.log(`no credentials for host. process will now exit.`);
    process.exit(1);
}

const main = () => {
    // console.log('eee');
    askQuestion();
}

function askQuestion() {

    readline.question('> ', cmd => {
        if (cmd.trim() !== '') {
            // console.log("running cmd = " + cmd);
            //ptyProcess.write(cmd + '\n');
            gponSession.runCmd(cmd, (result) => {
                console.log(`cmd done, result is = \n---------------\n"${result}"\n----------------`);
            });
        }

        askQuestion();
    });
}

main();