output "function_name" { value = module.lambda.function_name }
output "function_arn" { value = module.lambda.function_arn }
output "log_group_name" { value = module.lambda.log_group_name }
output "route_prefix" { value = local.route_prefix }
output "resource_ids" { value = concat([aws_api_gateway_resource.domain.id], module.routing.resource_ids) }
output "integration_ids" { value = module.routing.integration_ids }
output "routes" { value = module.routing.route_keys }
