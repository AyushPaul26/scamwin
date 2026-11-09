// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Permissioned, publicly readable exact-host warnings; no truth or safety verdict.
/// @dev Hostname canonicalization/IDNA and review belong off-chain. ASCII DNS grammar is enforced here.
contract ThreatRegistryV1 is Ownable2Step {
    uint16 public constant VERSION = 1;
    uint64 public constant MIN_TTL = 1 hours;
    uint64 public constant MAX_TTL = 30 days;
    uint8 public constant MAX_CATEGORY = 8;
    uint8 public constant MAX_REASON = 8;

    struct PublisherConfig { bool enabled; uint64 epoch; }
    struct Assertion {
        uint32 revision;
        uint64 issuedAt;
        uint64 expiresAt;
        uint8 category;
        bool retracted;
    }

    mapping(address => PublisherConfig) public publisherConfig;
    mapping(address => bool) public guardians;
    // Caller-scoped, retained across epochs and across issue/update/retract operations.
    mapping(address => mapping(bytes32 => bool)) public usedOperationIds;
    mapping(address => mapping(uint64 => mapping(bytes32 => Assertion))) private assertions;
    bool public issuancePaused;

    error Unauthorized();
    error InvalidAddress();
    error PublisherDisabled();
    error IssuancePaused();
    error InvalidHostname();
    error InvalidTtl();
    error InvalidCategory();
    error InvalidReason();
    error InvalidOperationId();
    error OperationAlreadyUsed();
    error RevisionConflict(uint32 expected, uint32 actual);
    error AssertionMissing();
    error AlreadyRetracted();

    event PublisherConfigured(uint16 version, address indexed publisher, uint64 indexed epoch, bool enabled, address actor);
    event GuardianConfigured(uint16 version, address indexed guardian, bool enabled);
    event IssuancePauseChanged(uint16 version, bool paused, address indexed actor);
    event AssertionPublished(
        uint16 version, address indexed publisher, uint64 indexed epoch, bytes32 indexed indicator,
        string hostname, uint32 revision, uint64 issuedAt, uint64 expiresAt, uint8 category, bytes32 operationId
    );
    event AssertionRetracted(
        uint16 version, address indexed publisher, uint64 indexed epoch, bytes32 indexed indicator,
        uint32 revision, uint64 issuedAt, uint64 expiresAt, uint64 retractedAt, uint8 reasonCode,
        address actor, bytes32 operationId
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyGuardianOrOwner() {
        if (msg.sender != owner() && !guardians[msg.sender]) revert Unauthorized();
        _;
    }

    function setPublisher(address publisher, bool enabled) external onlyOwner {
        if (publisher == address(0)) revert InvalidAddress();
        PublisherConfig storage config = publisherConfig[publisher];
        if (enabled && !config.enabled) config.epoch += 1;
        config.enabled = enabled;
        emit PublisherConfigured(VERSION, publisher, config.epoch, enabled, msg.sender);
    }

    function setGuardian(address guardian, bool enabled) external onlyOwner {
        if (guardian == address(0)) revert InvalidAddress();
        guardians[guardian] = enabled;
        emit GuardianConfigured(VERSION, guardian, enabled);
    }

    function suspendPublisher(address publisher) external onlyGuardianOrOwner {
        if (publisher == address(0)) revert InvalidAddress();
        PublisherConfig storage config = publisherConfig[publisher];
        config.enabled = false;
        emit PublisherConfigured(VERSION, publisher, config.epoch, false, msg.sender);
    }

    function pauseIssuance() external onlyGuardianOrOwner {
        issuancePaused = true;
        emit IssuancePauseChanged(VERSION, true, msg.sender);
    }

    function resumeIssuance() external onlyOwner {
        issuancePaused = false;
        emit IssuancePauseChanged(VERSION, false, msg.sender);
    }

    function publish(string calldata hostname, uint8 category, uint64 ttlSeconds, uint32 expectedRevision, bytes32 operationId) external {
        if (issuancePaused) revert IssuancePaused();
        PublisherConfig memory config = publisherConfig[msg.sender];
        if (!config.enabled) revert PublisherDisabled();
        if (ttlSeconds < MIN_TTL || ttlSeconds > MAX_TTL) revert InvalidTtl();
        if (category == 0 || category > MAX_CATEGORY) revert InvalidCategory();
        bytes32 indicator = indicatorId(hostname);
        _consumeOperation(operationId);
        Assertion storage record = assertions[msg.sender][config.epoch][indicator];
        if (record.revision != expectedRevision) revert RevisionConflict(expectedRevision, record.revision);
        record.revision += 1;
        record.issuedAt = uint64(block.timestamp);
        record.expiresAt = uint64(block.timestamp) + ttlSeconds;
        record.category = category;
        record.retracted = false;
        emit AssertionPublished(VERSION, msg.sender, config.epoch, indicator, hostname, record.revision,
            record.issuedAt, record.expiresAt, category, operationId);
    }

    /// @notice Correct the current activation epoch. Past epochs are permanently inactive.
    function retract(address publisher, bytes32 indicator, uint32 expectedRevision, uint8 reasonCode, bytes32 operationId) external {
        if (msg.sender != publisher && msg.sender != owner() && !guardians[msg.sender]) revert Unauthorized();
        if (reasonCode == 0 || reasonCode > MAX_REASON) revert InvalidReason();
        _consumeOperation(operationId);
        uint64 epoch = publisherConfig[publisher].epoch;
        Assertion storage record = assertions[publisher][epoch][indicator];
        if (record.revision == 0) revert AssertionMissing();
        if (record.revision != expectedRevision) revert RevisionConflict(expectedRevision, record.revision);
        if (record.retracted) revert AlreadyRetracted();
        record.revision += 1;
        record.retracted = true;
        emit AssertionRetracted(VERSION, publisher, epoch, indicator, record.revision, record.issuedAt,
            record.expiresAt, uint64(block.timestamp), reasonCode, msg.sender, operationId);
    }

    function getAssertion(address publisher, uint64 epoch, bytes32 indicator) external view returns (Assertion memory) {
        return assertions[publisher][epoch][indicator];
    }

    function isActive(address publisher, uint64 epoch, bytes32 indicator) external view returns (bool) {
        PublisherConfig memory config = publisherConfig[publisher];
        Assertion memory record = assertions[publisher][epoch][indicator];
        return config.enabled && config.epoch == epoch && record.revision != 0 && !record.retracted && block.timestamp < record.expiresAt;
    }

    function indicatorId(string memory hostname) public pure returns (bytes32) {
        _validateHostname(bytes(hostname));
        return keccak256(abi.encode(uint16(1), uint8(1), hostname));
    }

    function _consumeOperation(bytes32 operationId) private {
        if (operationId == bytes32(0)) revert InvalidOperationId();
        if (usedOperationIds[msg.sender][operationId]) revert OperationAlreadyUsed();
        usedOperationIds[msg.sender][operationId] = true;
    }

    function _validateHostname(bytes memory host) private pure {
        if (host.length < 3 || host.length > 253) revert InvalidHostname();
        uint256 labelStart;
        uint256 dots;
        bool finalLabelHasLetter;
        for (uint256 i; i < host.length; ++i) {
            bytes1 c = host[i];
            if (c == ".") {
                if (i == labelStart || i - labelStart > 63 || host[i - 1] == "-") revert InvalidHostname();
                labelStart = i + 1;
                dots++;
                finalLabelHasLetter = false;
            } else {
                bool letter = c >= "a" && c <= "z";
                bool digit = c >= "0" && c <= "9";
                if (!letter && !digit && c != "-") revert InvalidHostname();
                if (i == labelStart && c == "-") revert InvalidHostname();
                if (letter) finalLabelHasLetter = true;
            }
        }
        if (dots == 0 || host.length == labelStart || host.length - labelStart > 63 || host[host.length - 1] == "-" || !finalLabelHasLetter) revert InvalidHostname();
        bytes memory tld = new bytes(host.length - labelStart);
        for (uint256 i; i < tld.length; ++i) tld[i] = host[labelStart + i];
        bytes32 suffix = keccak256(tld);
        if (suffix == keccak256("localhost") || suffix == keccak256("local") || suffix == keccak256("internal") ||
            suffix == keccak256("invalid") || suffix == keccak256("test") || suffix == keccak256("example") ||
            suffix == keccak256("onion") || suffix == keccak256("home") || suffix == keccak256("lan")) revert InvalidHostname();
    }
}
