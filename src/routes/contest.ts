import { Router } from "express";
import { ethers } from "ethers";
import { pbkdf2 } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);
const router = Router();

// ─── Config ───────────────────────────────────────────────────────────────────
const PROOF_SALT          = process.env.PROOF_SALT ?? "";
const DRPC_API_KEY        = process.env.DRPC_API_KEY ?? "";
const MAINNET_RPC         = DRPC_API_KEY
  ? `https://lb.drpc.org/ogrpc?network=ethereum&dkey=${DRPC_API_KEY}`
  : (process.env.MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com");
// Flashbots Protect: tx goes directly to builders, never visible in public mempool.
// Prevents MEV bots from front-running the unqrypt proof.
const FLASHBOTS_RPC       = "https://rpc.flashbots.net/fast";
const DEPLOYER_PK         = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const QRYPTUM_SIGNER_PK   = process.env.QRYPTUM_SIGNER_PK ?? "";
const ADMIN_TOKEN         = process.env.ADMIN_TOKEN ?? "";
const USDC_MAINNET        = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

let runtimeVaultAddress: string = process.env.CONTEST_VAULT_ADDRESS ?? "";

// ─── PersonalQryptSafeExperiment ABI + bytecode ───────────────────────────────
// Fork of PersonalQryptSafeV6. unqrypt has no onlyOwner; accepts recipient param.
// OTP proof chain is the sole auth factor for unqrypt.
const EXPERIMENT_BYTECODE = "0x60803461012057601f61191438819003918201601f19168301916001600160401b038311848410176101255780849260409485528339810103126101205780516001600160a01b038116919082900361012057602001519060017f9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f005580156100eb5781156100b157600080546001600160a01b031916919091179055600155436002556040516117d8908161013c8239f35b60405162461bcd60e51b8152602060048201526012602482015271125b9d985b1a590818da185a5b881a19585960721b6044820152606490fd5b60405162461bcd60e51b815260206004820152600d60248201526c24b73b30b634b21037bbb732b960991b6044820152606490fd5b600080fd5b634e487b7160e01b600052604160045260246000fdfe608080604052600436101561001357600080fd5b600090813560e01c90816311be89a01461074e575080635122a6421461072257806358370bdb146107045780638da5cb5b146106dd57806396dac530146106bf578063a22b15131461067e578063ac893fa51461067e578063cf21d3f5146103945763ed6202681461008457600080fd5b346103915760803660031901126103915761009d61076e565b6064356001600160a01b038116916024359183900361023e576100be610857565b6100c9604435610893565b811561034d578215610314576001600160a01b03908116808552600360205260408520549092911680156102db5784546040516370a0823160e01b81526001600160a01b039091166004820181905290602081602481865afa80156102d05784918891610296575b5010610251578186923b1561024d57604051632770a7eb60e21b81526001600160a01b039290921660048301526024820184905282908290604490829084905af1801561024257610229575b50506040519063a9059cbb60e01b8552836004528060245260208560448180875af1600186511481161561020a575b82604052156101f6577fd691418967de8e6bbe97aa5be86de5b73d817a243f9563d62ed72b7aeb14d28d91602091436002558152a360016000805160206117838339815191525580f35b635274afe760e01b85526004839052602485fd5b600181151661022057833b15153d1516166101ac565b823d87823e3d90fd5b8161023391610784565b61023e57833861017d565b8380fd5b6040513d84823e3d90fd5b8280fd5b60405162461bcd60e51b815260206004820152601c60248201527f496e73756666696369656e7420717279707465642062616c616e6365000000006044820152606490fd5b9150506020813d6020116102c8575b816102b260209383610784565b810103126102c35783905138610131565b600080fd5b3d91506102a5565b6040513d89823e3d90fd5b60405162461bcd60e51b8152602060048201526011602482015270151bdad95b881b9bdd081c5c9e5c1d1959607a1b6044820152606490fd5b60405162461bcd60e51b8152602060048201526011602482015270125b9d985b1a59081c9958da5c1a595b9d607a1b6044820152606490fd5b606460405162461bcd60e51b815260206004820152602060248201527f416d6f756e74206d7573742062652067726561746572207468616e207a65726f6044820152fd5b80fd5b5034610391576060366003190112610391576103ae61076e565b815460243591906001600160a01b03163303610647576103cc610857565b6103d7604435610893565b620f4240821061060b576040516370a0823160e01b81523060048201526001600160a01b0382169190602081602481865afa9081156105635785916105d9575b50604051936323b872dd60e01b8652336004523060245260445260208560648180875af160018651148116156105ba575b8460405285606052156101f6576370a0823160e01b8452306004850152602084602481865afa938415610563578594610582575b50830392831161056e576001600160a01b0390610498906109b2565b8454911692906001600160a01b031684843b15610391576040516340c10f1960e01b81526001600160a01b03929092166004830152602482018390528160448183885af180156105635761052c575b5060207f8eedcaad9e05ba593ed12c40b78d30b6cebca59bc773cc4a38a95e7a0af92cd99143600255604051908152a360016000805160206117838339815191525580f35b8461055b7f8eedcaad9e05ba593ed12c40b78d30b6cebca59bc773cc4a38a95e7a0af92cd99396602093610784565b9491506104e7565b6040513d87823e3d90fd5b634e487b7160e01b84526011600452602484fd5b9093506020813d6020116105b2575b8161059e60209383610784565b810103126105ae5751923861047c565b8480fd5b3d9150610591565b60018115166105d057833b15153d151616610448565b843d87823e3d90fd5b90506020813d602011610603575b816105f460209383610784565b810103126105ae575138610417565b3d91506105e7565b60405162461bcd60e51b8152602060048201526014602482015273416d6f756e742062656c6f77206d696e696d756d60601b6044820152606490fd5b60405162461bcd60e51b815260206004820152600f60248201526e2737ba103b30bab63a1037bbb732b960891b6044820152606490fd5b5034610391576020366003190112610391576020906001600160a01b036106a361076e565b16815260038252604060018060a01b0391205416604051908152f35b50346103915780600319360112610391576020600254604051908152f35b5034610391578060031936011261039157546040516001600160a01b039091168152602090f35b50346103915780600319360112610391576020604051620f42408152f35b503461039157602036600319011261039157602061074661074161076e565b6107bc565b604051908152f35b90503461076a578160031936011261076a576020906001548152f35b5080fd5b600435906001600160a01b03821682036102c357565b90601f8019910116810190811067ffffffffffffffff8211176107a657604052565b634e487b7160e01b600052604160045260246000fd5b6001600160a01b0390811660009081526003602052604090205416801561085157602060018060a01b03600054166024604051809481936370a0823160e01b835260048301525afa90811561084557600091610816575090565b90506020813d60201161083d575b8161083160209383610784565b810103126102c3575190565b3d9150610824565b6040513d6000823e3d90fd5b50600090565b6002600080516020611783833981519152541461088257600260008051602061178383398151915255565b633ee5aeb560e01b60005260046000fd5b6040516020810190828252602081526108ad604082610784565b519020600154036108bd57600155565b60405162461bcd60e51b815260206004820152601360248201527224b73b30b634b2103b30bab63a10383937b7b360691b6044820152606490fd5b60005b83811061090b5750506000910152565b81810151838201526020016108fb565b6020818303126102c35780519067ffffffffffffffff82116102c3570181601f820112156102c357805167ffffffffffffffff81116107a6576040519261096c601f8301601f191660200185610784565b818452602082840101116102c35761098a91602080850191016108f8565b90565b906020916109a6815180928185528580860191016108f8565b601f01601f1916010190565b6001600160a01b03908116600081815260036020526040902054909116610c38576040516306fdde0360e01b815260129060008082600481875afa90918282610c1b575b5050610bef5750604051610a0b604082610784565b600681526538aa37b5b2b760d11b60208201525b6040516395d89b4160e01b8152600081600481875afa60009181610bca575b50610b8c5750604051610a52604082610784565b600481526338aa25a760e11b6020820152915b60405163313ce56760e01b8152602081600481885afa8091600091610b50575b5090610b48575b5060405192610b2f908185019185831067ffffffffffffffff8411176107a657610adb606092610acd889760ff94610c548a3960808752608087019061098d565b90858203602087015261098d565b933060408501521691015203906000f080156108455760018060a01b031681819260005260036020526040600020826bffffffffffffffffffffffff60a01b8254161790557f1e038aee04ae5c739a948a4cb5e14d480698ed166c8fbfb74acac9938b147888600080a390565b905038610a8c565b6020813d602011610b84575b81610b6960209383610784565b8101031261076a57519060ff82168203610391575038610a85565b3d9150610b5c565b610bc460216040518093607160f81b6020830152610bb381518092602086860191016108f8565b81010301601f198101835282610784565b91610a65565b610be89192503d806000833e610be08183610784565b81019061091b565b9038610a3e565b610c1660216040518093607160f81b6020830152610bb381518092602086860191016108f8565b610a1f565b610c309293503d8091833e610be08183610784565b9038806109f6565b6000908152600360205260409020546001600160a01b03169056fe60806040523461038a57610b2f803803806100198161038f565b92833981019060808183031261038a5780516001600160401b03811161038a57826100459183016103b4565b602082015190926001600160401b03821161038a576100659183016103b4565b604082015190916001600160a01b0382169182900361038a57606001519060ff8216820361038a5783516001600160401b03811161028657600354600181811c91168015610380575b602082101461026657601f811161030e575b50602094601f82116001146102a75794819293949560009261029c575b50508160011b916000199060031b1c1916176003555b82516001600160401b03811161028657600454600181811c9116801561027c575b602082101461026657601f81116101f4575b506020601f821160011461018d5781929394600092610182575b50508160011b916000199060031b1c1916176004555b6005549160ff60a01b9060a01b169160018060a81b031916171760055560405161070f90816104208239f35b015190503880610140565b601f198216906004600052806000209160005b8181106101dc575095836001959697106101c3575b505050811b01600455610156565b015160001960f88460031b161c191690553880806101b5565b9192602060018192868b0151815501940192016101a0565b81811115610126576004600052601f820160051c7f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b6020841061025d575b81601f9101920160051c039060005b82811061024f575050610126565b600082820155600101610241565b60009150610232565b634e487b7160e01b600052602260045260246000fd5b90607f1690610114565b634e487b7160e01b600052604160045260246000fd5b0151905038806100dd565b601f198216956003600052806000209160005b8881106102f6575083600195969798106102dd575b505050811b016003556100f3565b015160001960f88460031b161c191690553880806102cf565b919260206001819286850151815501940192016102ba565b818111156100c0576003600052601f820160051c7fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b60208410610377575b81601f9101920160051c039060005b8281106103695750506100c0565b60008282015560010161035b565b6000915061034c565b90607f16906100ae565b600080fd5b6040519190601f01601f191682016001600160401b0381118382101761028657604052565b81601f8201121561038a578051906001600160401b038211610286576103e3601f8301601f191660200161038f565b928284526020838301011161038a5760005b82811061040a57505060206000918301015290565b806020809284010151828287010152016103f556fe608080604052600436101561001357600080fd5b60003560e01c90816306fdde03146104ec57508063095ea7b31461048d57806318160ddd1461046f57806323b872dd1461044d578063313ce5671461042957806340c10f191461036857806370a082311461032e57806395d89b411461020d5780639dc29fac14610141578063a9059cbb14610122578063dd62ed3e146100d15763fbfa77cf146100a357600080fd5b346100cc5760003660031901126100cc576005546040516001600160a01b039091168152602090f35b600080fd5b346100cc5760403660031901126100cc576100ea610608565b6100f261061e565b6001600160a01b039182166000908152600160209081526040808320949093168252928352819020549051908152f35b346100cc5760403660031901126100cc5761013b610608565b50610634565b346100cc5760403660031901126100cc5761015a610608565b6024359061017360018060a01b0360055416331461068d565b6001600160a01b03169081156101f7576000908282528160205260408220548181106101df5760208285937fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef93869787528684520360408620558060025403600255604051908152a380f35b60649363391434e360e21b8452600452602452604452fd5b634b637e8f60e11b600052600060045260246000fd5b346100cc5760003660031901126100cc5760405160006004548060011c90600181168015610324575b602083108114610310578285529081156102f4575060011461029d575b50819003601f01601f191681019067ffffffffffffffff82118183101761028757610283829182604052826105bf565b0390f35b634e487b7160e01b600052604160045260246000fd5b905060046000527f8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b6000905b8282106102de57506020915082010182610253565b60018160209254838588010152019101906102c9565b90506020925060ff191682840152151560051b82010182610253565b634e487b7160e01b84526022600452602484fd5b91607f1691610236565b346100cc5760203660031901126100cc576001600160a01b0361034f610608565b1660005260006020526020604060002054604051908152f35b346100cc5760403660031901126100cc57610381610608565b6024359061039a60018060a01b0360055416331461068d565b6001600160a01b0316801561041357600254918083018093116103fd576020926002557fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef600093849284845283825260408420818154019055604051908152a380f35b634e487b7160e01b600052601160045260246000fd5b63ec442f0560e01b600052600060045260246000fd5b346100cc5760003660031901126100cc57602060ff60055460a01c16604051908152f35b346100cc5760603660031901126100cc57610466610608565b5061013b61061e565b346100cc5760003660031901126100cc576020600254604051908152f35b346100cc5760403660031901126100cc576104a6610608565b5060405162461bcd60e51b815260206004820152601a60248201527f71546f6b656e3a20617070726f76616c732064697361626c65640000000000006044820152606490fd5b346100cc5760003660031901126100cc5760006003548060011c906001811680156105b5575b602083108114610310578285529081156102f4575060011461055e5750819003601f01601f191681019067ffffffffffffffff82118183101761028757610283829182604052826105bf565b905060036000527fc2575a0e9e593c00f959f8c92f12db2869c3395a3b0502d05e2516446f71f85b6000905b82821061059f57506020915082010182610253565b600181602092548385880101520191019061058a565b91607f1691610512565b91909160208152825180602083015260005b8181106105f2575060409293506000838284010152601f8019910116010190565b80602080928701015160408286010152016105d1565b600435906001600160a01b03821682036100cc57565b602435906001600160a01b03821682036100cc57565b60405162461bcd60e51b815260206004820152602b60248201527f71546f6b656e3a207472616e73666572732064697361626c65642c207573652060448201526a05172797074756d206170760ac1b6064820152608490fd5b1561069457565b60405162461bcd60e51b815260206004820152601b60248201527f4f6e6c79205152595054414e4b2063616e2063616c6c207468697300000000006044820152606490fdfea264697066735822122080870c9e1ee319a18344b1aec633397a22cf1a2d0e7ee60d1d0b2b7f36b1136364736f6c634300082200339b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00a2646970667358221220429bf31eb81a94e13a493dc3a21964ce8cd2c3a7bd741cec14f0365b56178e7f64736f6c63430008220033";

const EXPERIMENT_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_owner",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "_initialChainHead",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "ReentrancyGuardReentrantCall",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "SafeERC20FailedOperation",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "qToken",
        "type": "address"
      }
    ],
    "name": "QTokenCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "qToken",
        "type": "address"
      }
    ],
    "name": "TokenQrypted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      }
    ],
    "name": "TokenUnqrypted",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "MINIMUM_SHIELD_AMOUNT",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "tokenAddress",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "proof",
        "type": "bytes32"
      }
    ],
    "name": "Qrypt",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getProofChainHead",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "tokenAddress",
        "type": "address"
      }
    ],
    "name": "getQTokenAddress",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "tokenAddress",
        "type": "address"
      }
    ],
    "name": "getQryptedBalance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "lastActivityBlock",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "qTokens",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "tokenAddress",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "proof",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      }
    ],
    "name": "unqrypt",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

const ERC20_ABI = [
  { type: "function", name: "balanceOf",  inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve",    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateProofFormat(proof: string): boolean {
  if (proof.length !== 6) return false;
  let letters = 0, digits = 0;
  for (const c of proof) {
    if (/[a-zA-Z]/.test(c)) letters++;
    else if (/[0-9]/.test(c)) digits++;
    else return false;
  }
  return letters === 3 && digits === 3;
}

async function deriveH0(vaultProof: string, vaultAddress: string): Promise<string> {
  const saltStr = vaultAddress.toLowerCase() + PROOF_SALT;
  const key = await pbkdf2Async(
    Buffer.from(vaultProof, "utf8"),
    Buffer.from(saltStr, "utf8"),
    200_000,
    32,
    "sha256"
  );
  return "0x" + key.toString("hex");
}

function keccak256Chain(h: string, steps: number): string {
  for (let i = 0; i < steps; i++) {
    h = ethers.keccak256(h);
  }
  return h;
}

/**
 * Scan H0 upward to find H_n where keccak256(H_n) === chainHead.
 * Returns the valid proof bytes32 or null if password is wrong.
 */
function findValidProof(H0: string, chainHead: string): string | null {
  let prev = H0;
  for (let i = 0; i < 100; i++) {
    const next = ethers.keccak256(prev);
    if (next.toLowerCase() === chainHead.toLowerCase()) return prev;
    prev = next;
  }
  return null;
}

function getProvider() {
  return new ethers.JsonRpcProvider(MAINNET_RPC);
}

function getFlashbotsProvider() {
  return new ethers.JsonRpcProvider(FLASHBOTS_RPC);
}

function getDeployerSigner() {
  if (!DEPLOYER_PK) throw new Error("DEPLOYER_PRIVATE_KEY not set");
  return new ethers.Wallet(DEPLOYER_PK, getProvider());
}

function getQryptumSigner() {
  if (!QRYPTUM_SIGNER_PK) throw new Error("QRYPTUM_SIGNER_PK not set");
  return new ethers.Wallet(QRYPTUM_SIGNER_PK, getProvider());
}

function getQryptumSignerFlashbots() {
  if (!QRYPTUM_SIGNER_PK) throw new Error("QRYPTUM_SIGNER_PK not set");
  return new ethers.Wallet(QRYPTUM_SIGNER_PK, getFlashbotsProvider());
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /contest/status
 * Returns current qUSDC balance and vault state for the Experiment vault.
 */
router.get("/contest/status", async (_req, res) => {
  const vaultAddress = runtimeVaultAddress;
  if (!vaultAddress) {
    return res.json({ deployed: false, active: false, vaultAddress: null, balance: "0", balanceFormatted: "0.00" });
  }

  try {
    const provider = getProvider();
    const vault = new ethers.Contract(vaultAddress, EXPERIMENT_ABI, provider);

    const balance = await vault.getQryptedBalance(USDC_MAINNET) as bigint;
    const active = balance > 0n;

    return res.json({
      deployed: true,
      active,
      vaultAddress,
      balance: balance.toString(),
      balanceFormatted: (Number(balance) / 1e6).toFixed(2),
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: "RPC error", details: String(err) });
  }
});

/**
 * POST /contest/setup
 * Admin only. Deploys PersonalQryptSafeExperiment vault.
 * Body: { vaultProof, adminToken }
 */
router.post("/contest/setup", async (req, res) => {
  const { vaultProof, adminToken } = req.body as { vaultProof?: string; adminToken?: string };

  if (!ADMIN_TOKEN || adminToken !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Invalid admin token" });
  }
  if (!vaultProof || !validateProofFormat(vaultProof)) {
    return res.status(400).json({ error: "Invalid vault proof. Need exactly 3 letters + 3 digits (e.g. abc123)" });
  }

  try {
    const signer = getDeployerSigner();
    const nonce = await signer.getNonce();
    const futureAddress = ethers.getCreateAddress({ from: signer.address, nonce });

    const H0 = await deriveH0(vaultProof, futureAddress);
    const H100 = keccak256Chain(H0, 100);

    const factory = new ethers.ContractFactory(EXPERIMENT_ABI, EXPERIMENT_BYTECODE, signer);
    const contract = await factory.deploy(signer.address, H100);
    const deployTx = contract.deploymentTransaction();
    await contract.waitForDeployment();
    const deployedAddress = await contract.getAddress();

    runtimeVaultAddress = deployedAddress;

    return res.json({
      vaultAddress: deployedAddress,
      chainHead: H100,
      deployTxHash: deployTx?.hash ?? null,
      note: `Set env CONTEST_VAULT_ADDRESS=${deployedAddress} and restart to persist across restarts`,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /contest/shield
 * Admin only. Shields USDC into the Experiment vault (Qrypt).
 * DEPLOYER must have approved USDC or this endpoint handles the approve too.
 * Body: { amount (in USDC, e.g. 40), adminToken }
 */
router.post("/contest/shield", async (req, res) => {
  const { amount, adminToken } = req.body as { amount?: number; adminToken?: string };

  if (!ADMIN_TOKEN || adminToken !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const vaultAddress = runtimeVaultAddress;
  if (!vaultAddress) {
    return res.status(503).json({ error: "Vault not deployed. Run /contest/setup first." });
  }

  const vaultProof = process.env.CONTEST_VAULT_PROOF ?? "";
  if (!vaultProof || !validateProofFormat(vaultProof)) {
    return res.status(503).json({ error: "CONTEST_VAULT_PROOF not set or invalid in env" });
  }

  const amountUsdc = amount ?? 0;
  if (amountUsdc <= 0) {
    return res.status(400).json({ error: "Amount must be positive (in USDC, e.g. 40)" });
  }

  try {
    const signer = getDeployerSigner();
    const provider = getProvider();

    const vault = new ethers.Contract(vaultAddress, EXPERIMENT_ABI, signer);
    const usdc = new ethers.Contract(USDC_MAINNET, ERC20_ABI, signer);

    // Read current chain head to find which proof to use
    const chainHead = await vault.getProofChainHead() as string;
    const H0 = await deriveH0(vaultProof, vaultAddress);
    const proof = findValidProof(H0, chainHead);
    if (!proof) {
      return res.status(400).json({ error: "Cannot derive valid proof. Check CONTEST_VAULT_PROOF matches the vault." });
    }

    const rawAmount = BigInt(Math.round(amountUsdc * 1e6));

    // Approve USDC spend
    const approveTx = await usdc.approve(vaultAddress, rawAmount);
    await approveTx.wait();

    // Shield USDC into vault
    const qryptTx = await (vault as any).Qrypt(USDC_MAINNET, rawAmount, proof);
    const receipt = await qryptTx.wait();

    const newBalance = await vault.getQryptedBalance(USDC_MAINNET) as bigint;

    return res.json({
      success: true,
      shieldedAmount: amountUsdc,
      qryptTxHash: receipt.hash,
      qUSDCBalance: (Number(newBalance) / 1e6).toFixed(2),
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /contest/claim
 * Public. Attempt to claim from the Experiment vault.
 * Verifies proof off-chain first — wrong guesses cost no gas.
 * Body: { vaultProof, recipient }
 */
router.post("/contest/claim", async (req, res) => {
  const { vaultProof, recipient } = req.body as { vaultProof?: string; recipient?: string };

  const vaultAddress = runtimeVaultAddress;
  if (!vaultAddress) {
    return res.status(503).json({ error: "Experiment vault not deployed yet. Check back soon." });
  }
  if (!vaultProof || typeof vaultProof !== "string") {
    return res.status(400).json({ error: "Missing vault proof" });
  }
  if (!recipient || !ethers.isAddress(recipient)) {
    return res.status(400).json({ error: "Invalid recipient address" });
  }

  try {
    const provider = getProvider();
    const vault = new ethers.Contract(vaultAddress, EXPERIMENT_ABI, provider);

    // Check if vault still has qUSDC balance
    const balance = await vault.getQryptedBalance(USDC_MAINNET) as bigint;
    if (balance === 0n) {
      return res.status(410).json({ error: "Vault is empty. Contest over." });
    }

    // Read current chain head from contract
    const chainHead = await vault.getProofChainHead() as string;

    // Derive H0 from the submitted guess
    const H0 = await deriveH0(vaultProof, vaultAddress);

    // Off-chain proof check — reject wrong guesses without sending any tx
    const proof = findValidProof(H0, chainHead);
    if (!proof) {
      return res.status(400).json({ error: "Wrong vault proof. Try again." });
    }

    // Proof is correct — broadcast via Flashbots Protect to hide proof from mempool.
    // This prevents MEV bots from front-running the unqrypt tx by copying the proof.
    const signer = getQryptumSignerFlashbots();

    // Fetch nonce from normal RPC (Flashbots RPC mirrors state but normal is more reliable)
    const normalProvider = getProvider();
    const nonce = await normalProvider.getTransactionCount(signer.address, "pending");

    // Use EIP-1559 with elevated maxPriorityFeePerGas to win block inclusion over copycats
    const feeData = await normalProvider.getFeeData();
    const maxFeePerGas = (feeData.maxFeePerGas ?? ethers.parseUnits("30", "gwei")) * 2n;
    const maxPriorityFeePerGas = ethers.parseUnits("5", "gwei");

    const vaultWithSigner = new ethers.Contract(vaultAddress, EXPERIMENT_ABI, signer);
    const tx = await (vaultWithSigner as any).unqrypt(
      USDC_MAINNET, balance, proof, recipient,
      { nonce, maxFeePerGas, maxPriorityFeePerGas }
    );

    // Flashbots /fast endpoint targets next 25 blocks (~5 min window).
    // Wait up to 3 min for inclusion before timing out.
    const receiptPromise = tx.wait();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Flashbots inclusion timeout after 3 min")), 180_000)
    );
    const receipt = await Promise.race([receiptPromise, timeoutPromise]);

    return res.json({
      success: true,
      txHash: receipt.hash,
      recipient,
      amountUsdc: (Number(balance) / 1e6).toFixed(2),
      broadcaster: signer.address,
      note: "Sent via Flashbots Protect (private mempool)",
    });
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes("Invalid vault proof")) {
      return res.status(400).json({ error: "Wrong vault proof. Try again." });
    }
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /contest/debug
 * Admin only. Checks chain head alignment between env and on-chain.
 */
router.get("/contest/debug", async (req, res) => {
  const adminToken = req.query.adminToken as string;
  if (!ADMIN_TOKEN || adminToken !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const vaultAddress = runtimeVaultAddress;
  if (!vaultAddress) return res.status(503).json({ error: "No vault set" });

  const vaultProof = process.env.CONTEST_VAULT_PROOF ?? "";

  try {
    const provider = getProvider();
    const vault = new ethers.Contract(vaultAddress, EXPERIMENT_ABI, provider);
    const chainHead = await vault.getProofChainHead() as string;
    const balance = await vault.getQryptedBalance(USDC_MAINNET) as bigint;

    let matchInfo: object = { note: "CONTEST_VAULT_PROOF not set in env" };
    if (vaultProof && validateProofFormat(vaultProof)) {
      const H0 = await deriveH0(vaultProof, vaultAddress);
      const expectedH100 = keccak256Chain(H0, 100);
      const proof = findValidProof(H0, chainHead);
      matchInfo = {
        expectedH100,
        currentChainHead: chainHead,
        headMatchesH100: expectedH100.toLowerCase() === chainHead.toLowerCase(),
        validProofFound: proof !== null,
        vaultProofFormat: validateProofFormat(vaultProof) ? "valid" : "INVALID",
      };
    }

    return res.json({
      vaultAddress,
      chainHead,
      qUSDCBalance: (Number(balance) / 1e6).toFixed(2),
      ...matchInfo,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /contest/reshield
 * Admin only. Re-shield USDC into the vault after it has been drained.
 * Uses the current proofChainHead to derive the next valid proof, then calls Qrypt().
 */
router.post("/contest/reshield", async (req, res) => {
  const { adminToken, amountUsdc } = req.body as { adminToken?: string; amountUsdc?: number };
  if (!ADMIN_TOKEN || adminToken !== ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });

  const vaultAddress = runtimeVaultAddress;
  if (!vaultAddress) return res.status(503).json({ error: "No vault set" });

  const vaultProof = process.env.CONTEST_VAULT_PROOF ?? "";
  if (!vaultProof || !validateProofFormat(vaultProof)) {
    return res.status(500).json({ error: "CONTEST_VAULT_PROOF not configured on server" });
  }

  const targetUsdc = amountUsdc ?? CONTEST_VAULT_AMOUNT_USDC;
  if (!targetUsdc || targetUsdc <= 0) return res.status(400).json({ error: "Invalid amountUsdc" });

  try {
    const signer   = getDeployerSigner();
    const provider = getProvider();
    const vault    = new ethers.Contract(vaultAddress, EXPERIMENT_ABI, provider);

    const existingBalance = await vault.getQryptedBalance(USDC_MAINNET) as bigint;
    if (existingBalance > 0n) {
      return res.status(409).json({
        error: "Vault is not empty",
        balanceUsdc: (Number(existingBalance) / 1e6).toFixed(2),
      });
    }

    const chainHead = await vault.getProofChainHead() as string;
    const H0        = await deriveH0(vaultProof, vaultAddress);
    const proof     = findValidProof(H0, chainHead);
    if (!proof) {
      return res.status(500).json({ error: "Cannot derive valid proof. Chain head may be out of sync with CONTEST_VAULT_PROOF." });
    }

    const rawAmount = BigInt(Math.round(targetUsdc * 1e6));
    const usdc      = new ethers.Contract(USDC_MAINNET, ERC20_ABI, signer);
    const deployerUSDC = await usdc.balanceOf(signer.address) as bigint;
    if (deployerUSDC < rawAmount) {
      return res.status(400).json({
        error: `Deployer has insufficient USDC. Have ${(Number(deployerUSDC)/1e6).toFixed(2)}, need ${targetUsdc}`,
      });
    }

    const approveTx = await usdc.approve(vaultAddress, rawAmount);
    await approveTx.wait();

    const vaultWithSigner = new ethers.Contract(vaultAddress, EXPERIMENT_ABI, signer);
    const qryptTx         = await (vaultWithSigner as any).Qrypt(USDC_MAINNET, rawAmount, proof);
    const receipt         = await qryptTx.wait();

    const newBalance = await vault.getQryptedBalance(USDC_MAINNET) as bigint;
    return res.json({
      success: true,
      txHash: receipt.hash,
      amountShielded: (Number(rawAmount) / 1e6).toFixed(2),
      newBalance: (Number(newBalance) / 1e6).toFixed(2),
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /contest/set-vault
 * Admin only. Update vault address at runtime.
 */
router.post("/contest/set-vault", (req, res) => {
  const { vaultAddress, adminToken } = req.body as { vaultAddress?: string; adminToken?: string };
  if (!ADMIN_TOKEN || adminToken !== ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  if (!vaultAddress || !ethers.isAddress(vaultAddress)) return res.status(400).json({ error: "Invalid address" });
  runtimeVaultAddress = vaultAddress;
  return res.json({ ok: true, vaultAddress });
});

// ─── Auto-setup on startup ────────────────────────────────────────────────────
// If CONTEST_VAULT_ADDRESS is already set → skip deploy but check if shielding needed.
// If not set and CONTEST_VAULT_PROOF is set → deploy + shield automatically.
// Required env vars: DEPLOYER_PRIVATE_KEY, PROOF_SALT, CONTEST_VAULT_PROOF
// Optional env vars: CONTEST_VAULT_AMOUNT_USDC (default 40), CONTEST_VAULT_ADDRESS

const CONTEST_VAULT_PROOF      = process.env.CONTEST_VAULT_PROOF ?? "";
const CONTEST_VAULT_AMOUNT_USDC = Number(process.env.CONTEST_VAULT_AMOUNT_USDC ?? "40");

async function autoSetup(): Promise<void> {
  if (!CONTEST_VAULT_PROOF || !validateProofFormat(CONTEST_VAULT_PROOF)) return;
  if (!DEPLOYER_PK) { console.warn("[contest] DEPLOYER_PRIVATE_KEY not set — skipping auto-setup"); return; }
  if (!PROOF_SALT)  { console.warn("[contest] PROOF_SALT not set — skipping auto-setup"); return; }

  try {
    const signer   = getDeployerSigner();
    const provider = getProvider();

    // ── Step 1: Deploy if needed ──────────────────────────────────────────────
    if (!runtimeVaultAddress) {
      console.log("[contest] No vault set — deploying PersonalQryptSafeExperiment...");

      const nonce         = await signer.getNonce();
      const futureAddress = ethers.getCreateAddress({ from: signer.address, nonce });
      const H0            = await deriveH0(CONTEST_VAULT_PROOF, futureAddress);
      const H100          = keccak256Chain(H0, 100);

      const factory  = new ethers.ContractFactory(EXPERIMENT_ABI, EXPERIMENT_BYTECODE, signer);
      const contract = await factory.deploy(signer.address, H100);
      await contract.waitForDeployment();
      const deployedAddress = await contract.getAddress();

      runtimeVaultAddress = deployedAddress;
      console.log("[contest] Deployed:", deployedAddress);
      console.log("[contest] Set Railway env CONTEST_VAULT_ADDRESS=" + deployedAddress);
    } else {
      console.log("[contest] Vault already set:", runtimeVaultAddress);
    }

    // ── Step 2: Shield USDC if qUSDC balance is 0 ────────────────────────────
    const vault    = new ethers.Contract(runtimeVaultAddress, EXPERIMENT_ABI, provider);
    const balance  = await vault.getQryptedBalance(USDC_MAINNET) as bigint;

    if (balance > 0n) {
      console.log("[contest] qUSDC balance already funded:", (Number(balance) / 1e6).toFixed(2), "qUSDC");
      return;
    }

    if (!CONTEST_VAULT_AMOUNT_USDC || CONTEST_VAULT_AMOUNT_USDC <= 0) {
      console.warn("[contest] CONTEST_VAULT_AMOUNT_USDC not set or zero — skipping shield step");
      return;
    }

    console.log("[contest] Shielding", CONTEST_VAULT_AMOUNT_USDC, "USDC into vault...");

    const chainHead = await vault.getProofChainHead() as string;
    const H0        = await deriveH0(CONTEST_VAULT_PROOF, runtimeVaultAddress);
    const proof     = findValidProof(H0, chainHead);

    if (!proof) {
      console.error("[contest] Cannot derive valid proof for shield step. Check CONTEST_VAULT_PROOF / PROOF_SALT.");
      return;
    }

    const rawAmount = BigInt(Math.round(CONTEST_VAULT_AMOUNT_USDC * 1e6));
    const usdc      = new ethers.Contract(USDC_MAINNET, ERC20_ABI, signer);

    const deployerUSDC = await usdc.balanceOf(signer.address) as bigint;
    if (deployerUSDC < rawAmount) {
      console.error(`[contest] Deployer has insufficient USDC. Have ${Number(deployerUSDC)/1e6} need ${CONTEST_VAULT_AMOUNT_USDC}`);
      return;
    }

    const approveTx = await usdc.approve(runtimeVaultAddress, rawAmount);
    await approveTx.wait();

    const vaultWithSigner = new ethers.Contract(runtimeVaultAddress, EXPERIMENT_ABI, signer);
    const qryptTx         = await (vaultWithSigner as any).Qrypt(USDC_MAINNET, rawAmount, proof);
    await qryptTx.wait();

    const newBalance = await vault.getQryptedBalance(USDC_MAINNET) as bigint;
    console.log("[contest] Shield done. qUSDC balance:", (Number(newBalance) / 1e6).toFixed(2));

  } catch (err) {
    console.error("[contest] Auto-setup error:", err);
  }
}

autoSetup();

export default router;
