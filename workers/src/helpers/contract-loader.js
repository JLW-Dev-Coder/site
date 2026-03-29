/**
 * Federated Contract Registry Loader
 * Loads contracts from platform-specific registries
 */

let cachedContracts = null;
let cacheTimestamp = null;
const CACHE_TTL = 3600000; // 1 hour

/**
 * Load all contracts from federated registries
 */
export async function loadAllContracts(env, forceRefresh = false) {
  if (!forceRefresh && cachedContracts && cacheTimestamp) {
    const age = Date.now() - cacheTimestamp;
    if (age < CACHE_TTL) {
      return cachedContracts;
    }
  }

  try {
    const masterRegistryObj = await env.R2_VIRTUAL_LAUNCH.get('contracts/contract-registry.json');
    if (!masterRegistryObj) {
      throw new Error('Master registry not found in R2');
    }
    const masterRegistry = await masterRegistryObj.json();

    const allContracts = [];

    for (const registryMeta of masterRegistry.registries) {
      if (registryMeta.status !== 'active') continue;

      const platformRegistryObj = await env.R2_VIRTUAL_LAUNCH.get(
        `contracts/registries/${registryMeta.platform}-registry.json`
      );
      if (!platformRegistryObj) {
        console.warn(`Platform registry not found: ${registryMeta.platform}`);
        continue;
      }

      const platformRegistry = await platformRegistryObj.json();

      platformRegistry.contracts.forEach(contract => {
        if (contract.status === 'deprecated') return;
        allContracts.push({
          ...contract,
          platform: registryMeta.platform,
          platformName: registryMeta.name,
          platformOwner: registryMeta.owner
        });
      });
    }

    cachedContracts = allContracts;
    cacheTimestamp = Date.now();

    return allContracts;
  } catch (error) {
    console.error('Failed to load contracts:', error);
    if (cachedContracts) {
      return cachedContracts;
    }
    throw error;
  }
}

/**
 * Find contract by endpoint and method
 */
export async function findContract(endpoint, method, env) {
  const contracts = await loadAllContracts(env);
  return contracts.find(c => c.endpoint === endpoint && c.method === method);
}

/**
 * Validate payload against contract schema
 */
export async function validateContract(endpoint, method, payload, env) {
  const contractMeta = await findContract(endpoint, method, env);

  if (!contractMeta) {
    throw new Error(`No contract found for ${method} ${endpoint}`);
  }

  const contractObj = await env.R2_VIRTUAL_LAUNCH.get(contractMeta.path);
  if (!contractObj) {
    throw new Error(`Contract file not found: ${contractMeta.path}`);
  }

  const contract = await contractObj.json();

  // Validate required fields
  if (contract.payload && contract.payload.required) {
    for (const field of contract.payload.required) {
      if (!(field in payload)) {
        return {
          valid: false,
          error: `Missing required field: ${field}`,
          contract: contractMeta.id
        };
      }
    }
  }

  // Validate field types
  if (contract.payload && contract.payload.properties) {
    for (const [field, schema] of Object.entries(contract.payload.properties)) {
      if (field in payload) {
        const value = payload[field];
        const expectedType = schema.type;

        if (expectedType === 'string' && typeof value !== 'string') {
          return {
            valid: false,
            error: `Field ${field} must be a string`,
            contract: contractMeta.id
          };
        }
        if (expectedType === 'number' && typeof value !== 'number') {
          return {
            valid: false,
            error: `Field ${field} must be a number`,
            contract: contractMeta.id
          };
        }
        if (schema.pattern && typeof value === 'string') {
          const regex = new RegExp(schema.pattern);
          if (!regex.test(value)) {
            return {
              valid: false,
              error: `Field ${field} does not match required pattern`,
              contract: contractMeta.id
            };
          }
        }
      }
    }
  }

  // Check for additional properties
  if (contract.payload && contract.payload.additionalProperties === false) {
    const allowedFields = Object.keys(contract.payload.properties || {});
    const extraFields = Object.keys(payload).filter(k => !allowedFields.includes(k));
    if (extraFields.length > 0) {
      return {
        valid: false,
        error: `Unexpected fields: ${extraFields.join(', ')}`,
        contract: contractMeta.id
      };
    }
  }

  return {
    valid: true,
    contract: contractMeta.id,
    schema: contract
  };
}
