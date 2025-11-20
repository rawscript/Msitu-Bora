// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract AlertLogger {
    
    struct Alert {
        string alertHash;
        uint256 timestamp;
        address logger;
        bool exists;
    }
    
    mapping(string => Alert) public alerts;
    string[] public alertHashes;
    
    event AlertLogged(
        string indexed alertHash,
        uint256 timestamp,
        address indexed logger
    );
    
    function logAlert(string memory alertHash, uint256 timestamp) public {
        require(bytes(alertHash).length > 0, "Alert hash cannot be empty");
        require(!alerts[alertHash].exists, "Alert already logged");
        
        alerts[alertHash] = Alert({
            alertHash: alertHash,
            timestamp: timestamp,
            logger: msg.sender,
            exists: true
        });
        
        alertHashes.push(alertHash);
        
        emit AlertLogged(alertHash, timestamp, msg.sender);
    }
    
    function getAlert(string memory alertHash) public view returns (uint256) {
        if (!alerts[alertHash].exists) {
            return 0;
        }
        return alerts[alertHash].timestamp;
    }
    
    function getAlertDetails(string memory alertHash) public view returns (
        string memory hash,
        uint256 timestamp,
        address logger,
        bool exists
    ) {
        Alert memory alert = alerts[alertHash];
        return (
            alert.alertHash,
            alert.timestamp,
            alert.logger,
            alert.exists
        );
    }
    
    function getTotalAlerts() public view returns (uint256) {
        return alertHashes.length;
    }
}