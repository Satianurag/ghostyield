// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Groth16Verifier - Production ZK-SNARK Verifier for GhostYield
/// @notice Verifies Groth16 proofs for Bitcoin vault verification
/// @dev Generated from vault.circom circuit using snarkjs
/// 
/// Circuit hash: 935f86db 991d8675 372fa9d6 6c852bde 900c9edd 6ad7e67a 18cc1210 3aedf691
/// Contribution hash: 292f7e5e 1dd25c9d 0495b492 2ecbc83c 4078a4ee 8dae5931 fb63ef26 eefe252d
contract Groth16Verifier {
    // Scalar field size
    uint256 constant r = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data (generated from vault.circom trusted setup)
    uint256 constant alphax  = 20491192805390485299153009773594534940189261866228447918068658471970481763042;
    uint256 constant alphay  = 9383485363053290200918347156157836566562967994039712273449902621266178545958;
    uint256 constant betax1  = 4252822878758300859123897981450591353533073413197771768651442665752259397132;
    uint256 constant betax2  = 6375614351688725206403948262868962793625744043794305715222011528459656738731;
    uint256 constant betay1  = 21847035105528745403288232691147584728191162732299865338377159692350059136679;
    uint256 constant betay2  = 10505242626370262277552901082094356697409835680220590971873171140371331206856;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 8241492684410910017364710450553737322240706983187296700047751699477798896671;
    uint256 constant deltax2 = 17488286500526082901900400089019201227918543299310544566959083049746604222881;
    uint256 constant deltay1 = 16306185372292698576644516278217019624431814660708475472367299369459064568953;
    uint256 constant deltay2 = 2233302068243783336475478492263255107594133507227352645954100930324650270996;

    // IC (Input Coefficients) for public inputs
    uint256 constant IC0x = 19393374728858456786869293144164581953746027182156678171926327532660828944198;
    uint256 constant IC0y = 12857082576735324548048365767071018422886126856134031167838055838308542118650;
    uint256 constant IC1x = 3026952882180253643472479733585948794270689481003921784452651670326457388627;
    uint256 constant IC1y = 18684904469707073091605229111655747874515259834800834670664649762352965290412;
    uint256 constant IC2x = 721080186202995254778098223751292465779017994455730432911054635841776671875;
    uint256 constant IC2y = 12273813363331014940016129070789688028964858932437872784905557687553973947472;

    // Events
    event ProofVerified(bytes32 indexed proofHash, bool valid);

    /// @notice Verifies a Groth16 proof (matches IGroth16Verifier interface)
    /// @param a G1 point of proof
    /// @param b G2 point of proof  
    /// @param c G1 point of proof
    /// @param input Public inputs (btcAmount)
    /// @return valid True if proof is valid
    function verify(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[2] memory input
    ) external view returns (bool) {
        // Input order: [vaultCommitment, btcAmount]
        return _verifyProof(a, b, c, input);
    }

    /// @notice Internal pairing-based verification (from snarkjs)
    function _verifyProof(
        uint256[2] memory _pA,
        uint256[2][2] memory _pB,
        uint256[2] memory _pC,
        uint256[2] memory _pubSignals
    ) internal view returns (bool) {
        // Check field elements
        if (_pA[0] >= q || _pA[1] >= q) return false;
        if (_pB[0][0] >= q || _pB[0][1] >= q || _pB[1][0] >= q || _pB[1][1] >= q) return false;
        if (_pC[0] >= q || _pC[1] >= q) return false;
        if (_pubSignals[0] >= r || _pubSignals[1] >= r) return false;

        // Compute vk_x (linear combination of IC with public inputs)
        uint256[2] memory vk_x = [IC0x, IC0y];
        
        // vk_x = IC0 + IC1 * pubSignals[0] + IC2 * pubSignals[1]
        (uint256 px, uint256 py) = _ecMul(IC1x, IC1y, _pubSignals[0]);
        (vk_x[0], vk_x[1]) = _ecAdd(vk_x[0], vk_x[1], px, py);
        
        (px, py) = _ecMul(IC2x, IC2y, _pubSignals[1]);
        (vk_x[0], vk_x[1]) = _ecAdd(vk_x[0], vk_x[1], px, py);

        // Negate A
        uint256[2] memory negA = [_pA[0], q - _pA[1]];

        // Prepare pairing inputs
        uint256[24] memory input;
        
        // -A, B
        input[0] = negA[0];
        input[1] = negA[1];
        input[2] = _pB[0][1];
        input[3] = _pB[0][0];
        input[4] = _pB[1][1];
        input[5] = _pB[1][0];
        
        // alpha, beta
        input[6] = alphax;
        input[7] = alphay;
        input[8] = betax2;
        input[9] = betax1;
        input[10] = betay2;
        input[11] = betay1;
        
        // vk_x, gamma
        input[12] = vk_x[0];
        input[13] = vk_x[1];
        input[14] = gammax2;
        input[15] = gammax1;
        input[16] = gammay2;
        input[17] = gammay1;
        
        // C, delta
        input[18] = _pC[0];
        input[19] = _pC[1];
        input[20] = deltax2;
        input[21] = deltax1;
        input[22] = deltay2;
        input[23] = deltay1;

        uint256[1] memory result;
        assembly {
            if iszero(staticcall(gas(), 8, input, 768, result, 32)) {
                revert(0, 0)
            }
        }
        return result[0] == 1;
    }

    /// @notice Elliptic curve addition
    function _ecAdd(uint256 x1, uint256 y1, uint256 x2, uint256 y2) 
        internal view returns (uint256, uint256) 
    {
        uint256[4] memory input = [x1, y1, x2, y2];
        uint256[2] memory result;
        
        assembly {
            if iszero(staticcall(gas(), 6, input, 128, result, 64)) {
                revert(0, 0)
            }
        }
        return (result[0], result[1]);
    }

    /// @notice Elliptic curve scalar multiplication
    function _ecMul(uint256 x, uint256 y, uint256 s) 
        internal view returns (uint256, uint256) 
    {
        uint256[3] memory input = [x, y, s];
        uint256[2] memory result;
        
        assembly {
            if iszero(staticcall(gas(), 7, input, 96, result, 64)) {
                revert(0, 0)
            }
        }
        return (result[0], result[1]);
    }
}
