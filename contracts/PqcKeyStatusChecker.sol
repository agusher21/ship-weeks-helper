// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal PQC key-status checker for the QoreChain Ship Weeks badge.
/// Calls the PQC key-status precompile (0x0A02) in the constructor so the
/// deployment transaction itself exercises the precompile, and exposes a
/// public view for later reads.
contract PqcKeyStatusChecker {
    address internal constant PQC_KEY_STATUS =
        0x0000000000000000000000000000000000000a02;

    bool public lastRegistered;
    uint8 public lastAlgorithmId;
    bytes public lastPubkey;

    constructor(address account) {
        (lastRegistered, lastAlgorithmId, lastPubkey) = statusOf(account);
    }

    function statusOf(address account)
        public
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey)
    {
        (bool ok, bytes memory ret) = PQC_KEY_STATUS.staticcall(
            abi.encodeWithSignature("pqcKeyStatus(address)", account)
        );
        require(ok, "precompile call failed");
        (registered, algorithmId, pubkey) = abi.decode(
            ret,
            (bool, uint8, bytes)
        );
    }
}
